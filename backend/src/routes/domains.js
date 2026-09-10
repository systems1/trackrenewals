const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getSSLRenewalDate } = require('../utils/ssl-checker');
const { normalizeHostname } = require('../utils/hostname');
const { syncDomainCertificates } = require('../services/cert-sync');
const { computeStatus } = require('../services/status');
const multer = require('multer');
const csvParser = require('csv-parser');
const fs = require('fs');

const router = express.Router();
const upload = multer({ dest: '/tmp/' });

router.use(requireAuth);

// ── List domains (with cert count) ────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT d.*,
              (SELECT COUNT(*) FROM certs c WHERE c.domain_id = d.id) AS cert_count
       FROM domains d
       WHERE d.user_id = $1
       ORDER BY d.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// ── Create domain ──────────────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { domain_name, notes } = req.body;

    if (!domain_name || typeof domain_name !== 'string') {
      return res.status(400).json({ error: 'domain_name is required' });
    }

    // Accept "https://yahoo.com/" / "www.yahoo.com" / etc., store the bare host.
    const normalized = normalizeHostname(domain_name);
    if (!normalized) {
      return res.status(400).json({ error: 'domain_name could not be parsed as a hostname' });
    }

    const domainResult = await pool.query(
      'INSERT INTO domains (user_id, domain_name, notes) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, normalized, notes || '']
    );

    const inserted = domainResult.rows[0];

    // Agentless cert discovery (CT logs) + endpoint scan, in the background.
    // The dashboard shows the domain as "scanning…" until last_synced_at lands.
    // syncDomainCertificates is the single source of truth for ssl_renewal /
    // cert_status — no legacy TLS write here (it would race and clobber the scan).
    syncDomainCertificates(inserted.id, inserted.domain_name).catch((err) => {
      console.error(`[cert-sync] background sync failed for ${inserted.domain_name}:`, err);
    });

    res.status(201).json(inserted);
  } catch (err) {
    if (err.code === '23505') {
      // unique_violation (user_id, domain_name)
      return res.status(409).json({ error: 'Domain already exists for this user' });
    }
    next(err);
  }
});

// ── Cert detail for a domain (CT history + served cert + status) ─────────────
// Shared payload builder for GET /:id/certs and POST /:id/refresh.
async function buildCertPayload(domain) {
  const certsRes = await pool.query(
    `SELECT serial, fingerprint, common_name, sans, issuer, not_before, not_after, source, first_seen, last_seen
     FROM certs WHERE domain_id = $1 ORDER BY not_before DESC NULLS LAST LIMIT 100`,
    [domain.id]
  );

  const scanRes = await pool.query(
    'SELECT * FROM scans WHERE domain_id = $1 ORDER BY scanned_at DESC LIMIT 1',
    [domain.id]
  );
  const latestScan = scanRes.rows[0] || null;

  const servedCert = latestScan
    ? {
        host: latestScan.host,
        serial: latestScan.served_serial,
        fingerprint: latestScan.served_fingerprint,
        common_name: latestScan.served_common_name,
        not_after: latestScan.served_not_after,
        issuer: latestScan.served_issuer,
        chain_ok: latestScan.chain_ok,
      }
    : null;

  const { domainStatus, certs } = computeStatus({
    ctCerts: certsRes.rows.map((r) => ({
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

  return {
    domain: {
      ...domain,
      cert_status: domainStatus,
    },
    status: domainStatus,
    certs,
    servedCert,
    last_synced_at: domain.last_synced_at,
  };
}

// GET a domain's certificates (does not re-scan; returns stored state).
router.get('/:id/certs', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid domain id' });
    }
    const lookup = await pool.query(
      'SELECT * FROM domains WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (lookup.rowCount === 0) {
      return res.status(404).json({ error: 'Domain not found' });
    }
    res.json(await buildCertPayload(lookup.rows[0]));
  } catch (err) {
    next(err);
  }
});

// POST a manual re-scan: CT + endpoint, then return fresh payload.
router.post('/:id/refresh', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid domain id' });
    }
    const lookup = await pool.query(
      'SELECT * FROM domains WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (lookup.rowCount === 0) {
      return res.status(404).json({ error: 'Domain not found' });
    }
    const domain = lookup.rows[0];
    await syncDomainCertificates(domain.id, domain.domain_name);

    const fresh = await pool.query('SELECT * FROM domains WHERE id = $1', [id]);
    res.json(await buildCertPayload(fresh.rows[0]));
  } catch (err) {
    next(err);
  }
});

// ── Update domain notes ────────────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid domain id' });
    }

    const { notes } = req.body;

    const result = await pool.query(
      'UPDATE domains SET notes = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *',
      [notes || '', id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    const updated = result.rows[0];

    // Notes update only. cert_status / ssl_renewal are owned by the cert-sync
    // engine; a manual re-check is available via POST /:id/refresh.
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── Refresh SSL date manually ──────────────────────────────────────────────────
router.post('/:id/refresh-ssl', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid domain id' });
    }

    const lookup = await pool.query(
      'SELECT domain_name FROM domains WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (lookup.rowCount === 0) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    const domainName = lookup.rows[0].domain_name;
    const sslDate = await getSSLRenewalDate(domainName.trim());

    if (sslDate) {
      const result = await pool.query(
        'UPDATE domains SET ssl_renewal = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *',
        [sslDate, id, req.user.id]
      );
      return res.json(result.rows[0]);
    }

    // Return current row unchanged even if SSL lookup failed
    const result = await pool.query(
      'SELECT * FROM domains WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ── Import domains from CSV ────────────────────────────────────────────────────
router.post('/import', upload.single('csvFile'), async (req, res, next) => {
  try {
    if (!req.file || !req.file.path) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    const filePath = req.file.path;
    const rows = [];

    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csvParser({ headers: false }))
        .on('data', (row) => rows.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const cells = Object.values(row);
        if (!cells.length) continue;

        if (typeof cells[0] === 'string' && cells[0].toLowerCase().includes('domain')) {
          continue;
        }

        const domainName = normalizeHostname(cells[0]);
        const notes = cells[1] || '';

        if (!domainName) continue;

        const insertResult = await pool.query(
          'INSERT INTO domains (user_id, domain_name, notes) VALUES ($1, $2, $3) ON CONFLICT (user_id, domain_name) DO NOTHING RETURNING *',
          [req.user.id, domainName, notes]
        );

        if (insertResult.rowCount === 0) {
          skipped += 1;
          continue;
        }

        const inserted = insertResult.rows[0];
        imported += 1;

        // Kick off the cert-intelligence sync in the background (CT + TLS scan).
        // Rows stay "not-scanned" until the sync lands. Runs concurrently with
        // the rest of the import, so large files are no longer bottlenecked by
        // per-row serial SSL checks.
        syncDomainCertificates(inserted.id, inserted.domain_name).catch((err) => {
          console.error(`[cert-sync] background sync failed for ${inserted.domain_name}:`, err);
        });
      } catch (rowErr) {
        // Ignore row-level errors and continue processing
      }
    }

    fs.unlink(filePath, () => {});

    res.json({ imported, skipped });
  } catch (err) {
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }
    next(err);
  }
});

// ── Export domains to CSV ──────────────────────────────────────────────────────
router.get('/export', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT domain_name, notes, ssl_renewal FROM domains WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );

    let csv = 'domain_name,notes,ssl_expires\n';
    for (const row of result.rows) {
      const domainName = row.domain_name || '';
      const notes = row.notes || '';
      const sslRenewal = row.ssl_renewal ? row.ssl_renewal.toISOString() : '';
      const needsQuotes = notes.includes(',') || notes.includes('\n') || notes.includes('"');
      const escapedNotes = needsQuotes ? `"${notes.replace(/"/g, '""')}"` : notes;
      csv += `${domainName},${escapedNotes},${sslRenewal}\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="domains.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// ── Delete domain ──────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid domain id' });
    }

    const result = await pool.query(
      'DELETE FROM domains WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
