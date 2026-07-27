const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getSSLRenewalDate } = require('../utils/ssl-checker');
const multer = require('multer');
const csvParser = require('csv-parser');
const fs = require('fs');

const router = express.Router();
const upload = multer({ dest: '/tmp/' });

router.use(requireAuth);

// ── List domains ───────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM domains WHERE user_id = $1 ORDER BY created_at DESC',
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

    const domainResult = await pool.query(
      'INSERT INTO domains (user_id, domain_name, notes) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, domain_name.trim(), notes || '']
    );

    const inserted = domainResult.rows[0];

    const sslDate = await getSSLRenewalDate(inserted.domain_name.trim());
    if (sslDate) {
      const updateResult = await pool.query(
        'UPDATE domains SET ssl_renewal = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *',
        [sslDate, inserted.id, req.user.id]
      );
      return res.status(201).json(updateResult.rows[0]);
    }

    res.status(201).json(inserted);
  } catch (err) {
    if (err.code === '23505') {
      // unique_violation (user_id, domain_name)
      return res.status(409).json({ error: 'Domain already exists for this user' });
    }
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

    const sslDate = await getSSLRenewalDate(updated.domain_name.trim());
    if (sslDate) {
      const sslResult = await pool.query(
        'UPDATE domains SET ssl_renewal = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *',
        [sslDate, id, req.user.id]
      );
      return res.json(sslResult.rows[0]);
    }

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

        const domainName = cells[0].trim();
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

        try {
          const sslDate = await getSSLRenewalDate(inserted.domain_name.trim());
          if (sslDate) {
            await pool.query(
              'UPDATE domains SET ssl_renewal = $1, updated_at = NOW() WHERE id = $2',
              [sslDate, inserted.id]
            );
          }
        } catch (sslErr) {
          // Ignore SSL lookup errors for this row
        }
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
