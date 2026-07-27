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
`;

async function initDb() {
  try {
    await pool.query(schema);

    // Migrate: add ssl_renewal column if not exists on existing tables
    await pool.query('ALTER TABLE domains ADD COLUMN IF NOT EXISTS ssl_renewal TIMESTAMPTZ');

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
