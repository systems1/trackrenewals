// Cert-sync worker. Orchestrates one agentless refresh for a domain:
//   1. Pull certificate issuance history from CT logs (crt.sh)
//   2. Scan apex + www to learn what's actually served
//   3. Compute status (incl. issued-but-not-deployed) and persist
//
// Runs outbound-only — the app never accepts inbound connections from outside.
// A background run is kicked off on domain creation; a manual run is available
// via POST /api/domains/:id/refresh.

const pool = require('../db');
const { fetchCertsFromCT } = require('./crt-sh');
const { scanHost } = require('./cert-scanner');
const { computeStatus } = require('./status');

const LOG = (msg) => console.log(`[cert-sync] ${msg}`);

async function upsertCtCerts(domainId, ctCerts) {
  for (const c of ctCerts) {
    await pool.query(
      `INSERT INTO certs (domain_id, serial, fingerprint, common_name, sans, issuer, not_before, not_after, source, first_seen, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ct', NOW(), NOW())
       ON CONFLICT (domain_id, serial) DO UPDATE SET
         fingerprint = EXCLUDED.fingerprint,
         common_name = EXCLUDED.common_name,
         sans = EXCLUDED.sans,
         issuer = EXCLUDED.issuer,
         not_before = EXCLUDED.not_before,
         not_after = EXCLUDED.not_after,
         last_seen = NOW()`,
      [domainId, c.serial, c.fingerprint || null, c.common_name, JSON.stringify(c.sans || []), c.issuer, c.not_before, c.not_after]
    );
  }
}

async function upsertScan(domainId, host, scan) {
  await pool.query(
    `INSERT INTO scans (domain_id, host, served_serial, served_fingerprint, served_common_name, served_not_after, served_issuer, chain_ok, scanned_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (domain_id, host) DO UPDATE SET
       served_serial = EXCLUDED.served_serial,
       served_fingerprint = EXCLUDED.served_fingerprint,
       served_common_name = EXCLUDED.served_common_name,
       served_not_after = EXCLUDED.served_not_after,
       served_issuer = EXCLUDED.served_issuer,
       chain_ok = EXCLUDED.chain_ok,
       scanned_at = NOW()`,
    [domainId, host, scan.serial, scan.fingerprint || null, scan.common_name, scan.not_after, scan.issuer, scan.chain_ok]
  );
}

async function syncDomainCertificates(domainId, domainName) {
  const host = domainName.trim().toLowerCase();

  // 1. CT issuance history.
  let ctCerts = [];
  try {
    ctCerts = await fetchCertsFromCT(host);
    LOG(`${host}: CT returned ${ctCerts.length} certs`);
  } catch (err) {
    LOG(`${host}: CT fetch failed (${err.message}); continuing with what we know`);
  }
  if (ctCerts.length > 0) {
    await upsertCtCerts(domainId, ctCerts);
  }

  // 2. Scan apex + www (outbound-only TLS handshakes).
  let servedCert = null;
  for (const h of [host, `www.${host}`]) {
    const scan = await scanHost(h);
    if (!scan) {
      LOG(`${host}: no TLS response from ${h}`);
      continue;
    }
    await upsertScan(domainId, h, scan);
    if (!servedCert) servedCert = scan;
  }

  // 3. Re-read stored CT certs so status matches what we persisted.
  const dbCerts = await pool.query(
    `SELECT serial, fingerprint, common_name, sans, issuer, not_before, not_after
     FROM certs WHERE domain_id = $1 ORDER BY not_before DESC NULLS LAST LIMIT 100`,
    [domainId]
  );

  const { domainStatus } = computeStatus({
    ctCerts: dbCerts.rows.map((r) => ({
      serial: r.serial,
      fingerprint: r.fingerprint,
      common_name: r.common_name,
      sans: r.sans || [],
      issuer: r.issuer,
      not_before: r.not_before,
      not_after: r.not_after,
    })),
    servedCert,
  });

  // 4. Persist domain-level state.
  await pool.query(
    `UPDATE domains SET cert_status = $1, ssl_renewal = $2, last_synced_at = NOW(), updated_at = NOW() WHERE id = $3`,
    [domainStatus, servedCert ? servedCert.not_after : null, domainId]
  );

  LOG(`${host}: status=${domainStatus} certs=${dbCerts.rows.length} servedHost=${servedCert ? servedCert.host : 'none'}`);
  return { domainStatus, certCount: dbCerts.rows.length, servedHost: servedCert ? servedCert.host : null };
}

module.exports = { syncDomainCertificates };
