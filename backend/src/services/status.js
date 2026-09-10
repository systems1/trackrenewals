// Certificate status computation — the agentless "is this safe?" logic.
//
// Combines two public data sources:
//   1. CT issuance history (certs issued for the domain, from crt.sh)
//   2. The cert actually being served today (from the TLS scan)
//
// The signature alert: **issued-but-not-deployed**. CT shows a new cert was
// issued (someone ran certbot / acme.sh — validation succeeded) but the server
// is still serving an older serial. The renewal happened on paper but was never
// installed → guaranteed outage when the served cert expires.

const DAY = 24 * 60 * 60 * 1000;
const EXPIRING_WINDOW_MS = 30 * DAY;

function ms(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

// A CT cert matches the served cert if either identity key agrees. crt.sh certs
// carry serials; CertSpotter certs carry sha256 fingerprints; the served cert
// (from the TLS scan) carries both.
function certMatches(cert, servedCert) {
  if (!cert || !servedCert) return false;
  if (cert.serial && servedCert.serial && cert.serial === servedCert.serial) return true;
  if (cert.fingerprint && servedCert.fingerprint && cert.fingerprint === servedCert.fingerprint) return true;
  return false;
}

// Per-cert validity for the CT history table.
function certStatus(notAfter, now) {
  const t = ms(notAfter);
  if (!t) return 'unknown';
  if (t < now) return 'expired';
  if (t < now + EXPIRING_WINDOW_MS) return 'expiring';
  return 'valid';
}

// Returns { domainStatus, certs[], servedCert }.
//   domainStatus: 'valid' | 'expiring' | 'expired' | 'issued-not-deployed'
//                 | 'scan-failed' | 'unknown'
function computeStatus({ ctCerts = [], servedCert = null, now = Date.now() } = {}) {
  // ctCerts: newest not_before first (as returned by crt-sh.js).
  const newestIssued = ctCerts.length > 0 ? ctCerts[0] : null;

  let domainStatus;
  if (servedCert && servedCert.not_after) {
    const servedExpiry = ms(servedCert.not_after);
    const timeLeft = servedExpiry - now;

    // A newer cert exists (issued after the served one) but isn't being served.
    const hasNewerIssued =
      newestIssued &&
      !certMatches(newestIssued, servedCert) &&
      ms(newestIssued.not_before) !== null &&
      (ms(servedCert.not_before) === null || ms(newestIssued.not_before) > ms(servedCert.not_before));

    if (timeLeft < 0) {
      domainStatus = 'expired';
    } else if (timeLeft < EXPIRING_WINDOW_MS) {
      domainStatus = hasNewerIssued ? 'issued-not-deployed' : 'expiring';
    } else {
      domainStatus = hasNewerIssued ? 'issued-not-deployed' : 'valid';
    }
  } else if (newestIssued) {
    // We know certs were issued, but the served endpoint couldn't be verified.
    domainStatus = 'scan-failed';
  } else {
    domainStatus = 'unknown';
  }

  const certs = ctCerts.map((c) => ({
    ...c,
    cert_status: certStatus(c.not_after, now),
    is_served: certMatches(c, servedCert),
  }));

  return { domainStatus, certs, servedCert };
}

module.exports = { computeStatus, certStatus };
