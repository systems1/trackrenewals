const pool = require('./db');

const schema = `
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    google_id     TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT,
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS domains (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    domain_name   TEXT NOT NULL,
    notes         TEXT DEFAULT '',
    ssl_renewal   TIMESTAMPTZ,
    cert_status   TEXT DEFAULT 'unknown',
    last_synced_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, domain_name)
);

CREATE TABLE IF NOT EXISTS teams (
    id            SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    email_domain  TEXT UNIQUE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
    id        SERIAL PRIMARY KEY,
    team_id   INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT DEFAULT 'member',
    UNIQUE(team_id, user_id)
);

CREATE TABLE IF NOT EXISTS certs (
    id            SERIAL PRIMARY KEY,
    domain_id     INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    serial        TEXT NOT NULL,
    fingerprint   TEXT,
    common_name   TEXT,
    sans          JSONB DEFAULT '[]',
    issuer        TEXT,
    not_before    TIMESTAMPTZ,
    not_after     TIMESTAMPTZ,
    source        TEXT DEFAULT 'ct',
    first_seen    TIMESTAMPTZ DEFAULT NOW(),
    last_seen     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(domain_id, serial)
);

CREATE TABLE IF NOT EXISTS scans (
    id               SERIAL PRIMARY KEY,
    domain_id        INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    host             TEXT NOT NULL,
    served_serial    TEXT,
    served_fingerprint TEXT,
    served_common_name TEXT,
    served_not_after TIMESTAMPTZ,
    served_issuer    TEXT,
    chain_ok         BOOLEAN,
    scanned_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(domain_id, host)
);
`;

async function initDb() {
  try {
    await pool.query(schema);

    // Migrate: add columns if not exists on existing tables
    await pool.query('ALTER TABLE domains ADD COLUMN IF NOT EXISTS ssl_renewal TIMESTAMPTZ');
    await pool.query('ALTER TABLE domains ADD COLUMN IF NOT EXISTS cert_status TEXT DEFAULT \'unknown\'');
    await pool.query('ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ');

    console.log('Database schema initialized.');
  } catch (err) {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  initDb().then(() => pool.end());
} else {
  module.exports = initDb;
}
