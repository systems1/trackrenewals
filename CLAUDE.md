# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A web app for tracking domains and their SSL renewal dates. Users log in via Google OAuth, add domains, attach notes, and see when each domain's SSL cert expires.

Full stack runs in Docker Compose: **PostgreSQL 16** + **Express backend** (port 3001) + **Vite/React frontend** (port 5173).

**Naming is inconsistent across the codebase** — this is intentional/organic, not a bug to "fix" silently:
- Folder/repo: `trackrenewals`
- UI branding: "TrackCertRenewals" (`LoginPage.jsx`, `Navbar.jsx`)
- DB name / Docker project: `domainnotes`
- npm packages: `domain-notes-backend`, `trackassets-frontend`

## Run / Develop

Everything runs in Docker:

```bash
docker compose down
docker compose up --build
```

- Frontend: http://localhost:5173 (Vite dev server with HMR — `./frontend` is volume-mounted, `node_modules` kept in an anonymous volume)
- Backend: http://localhost:3001
- Postgres: localhost:5432, user/pass `postgres/postgres`, db `domainnotes`
- `GET /api/health` → `{ status: 'ok' }`

**Required for auth:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET` in `.env` (see `.env.example`). Without them the app still boots but Google login fails.

There is **no linter**. There is one small test suite using Node's built-in runner: `cd backend && npm test` → `node --test test/hostname.test.js` (12 tests for `normalizeHostname`). Note: `node --test test/` **with a trailing slash fails** (`MODULE_NOT_FOUND`) on Node 22 — always pass the explicit file path. Backend `npm run dev`/`npm start` (nodemon/node), frontend `npm run build` (Vite). Host-side `vite build` needs Node 20+ (`crypto.getRandomValues`).

## Architecture

### Auth flow (cookie-based JWT, no sessions)
1. Frontend redirects to `GET /api/auth/google` → Passport Google OAuth
2. Callback (`GET /api/auth/google/callback`) upserts the user in `users`, signs a 7-day JWT, sets it as the `httpOnly` cookie named `token`, redirects to `FRONTEND_URL`
3. `requireAuth` middleware (`backend/src/middleware/auth.js`) verifies the cookie on every `/api/domains` route and attaches `req.user` — **the decoded JWT payload, not a DB row** (so `req.user.id` comes from the token)
4. `AuthContext` calls `/api/auth/me` on mount to restore the session

### SSL certificate intelligence (the core feature)

`backend/src/services/cert-sync.js` → `syncDomainCertificates(domainId, host)` is the **single source of truth** for `domains.ssl_renewal` and `domains.cert_status`. It is an agentless three-stage pipeline:

1. **CT ingestion** (`services/crt-sh.js`) — query crt.sh (public Certificate Transparency index) for the domain's full issuance history; falls back to CertSpotter if crt.sh times out (20s). CertSpotter certs have a fingerprint but **no serial**, so `crt-sh.js` synthesizes `serial: 'fp:' + fingerprint`.
2. **TLS endpoint scan** (`services/cert-scanner.js`) — outbound-only TLS handshakes to apex + `www.<host>` (6s timeout each); reads the served cert's serial/fingerprint/SANs/issuer/validity and chain status.
3. **Status computation** (`services/status.js`) — cross-references CT-issued vs served to produce one of: `valid` / `expiring` / `expired` / `issued-not-deployed` / `scan-failed` / `unknown`. Matches certs by serial **or** fingerprint.

Triggered in the background (fire-and-forget `.catch`) on domain create (POST `/api/domains`) and per row during CSV import; synchronously on POST `/api/domains/:id/refresh`. Dashboard rows show `not-scanned` until `last_synced_at` lands. Status vocabulary & "at risk" grouping: `expiring`/`issued-not-deployed`/`scan-failed` → at risk; `valid`/`unknown`/`not-scanned` → healthy.

- `backend/src/utils/hostname.js` → `normalizeHostname(input)` — the input normalizer used at insert/import and defensively inside the sync. Strips scheme/path/port/userinfo/trailing-dot, lowercases; `https://yahoo.com/` → `yahoo.com`; returns `null` for empty/garbage. Whatever is stored in `domains.domain_name` is a bare hostname.
- `backend/src/utils/ssl-checker.js` → `getSSLRenewalDate(hostname)` — LEGACY simple TLS checker, now used **only** by POST `/api/domains/:id/refresh-ssl`. It must NOT write in POST/PUT/import — that would clobber the scan-derived value (this dual-path race was removed 2026-09-10).
- Stored in `domains.ssl_renewal TIMESTAMPTZ` (last known served-cert expiry) + `domains.cert_status TEXT` + `domains.last_synced_at`; certs go to `certs` (unique on `(domain_id, serial)`), endpoint snapshots to `scans` (unique on `(domain_id, host)`).

All outbound calls swallow errors and return `null` — the app never crashes on a failed lookup, and it never accepts inbound connections from outside (agentless).

### CSV import/export
- Import: `POST /api/domains/import` (multipart field `csvFile`, `multer` → `/tmp/`). Header auto-detected (first row containing "domain"), hostnames normalized via `normalizeHostname`, duplicates skipped via `ON CONFLICT DO NOTHING`, bad rows ignored. Each inserted row kicks off a **background** cert sync (no per-row blocking SSL check — large files import fast).
- Export: `GET /api/domains/export` → `domains.csv` attachment with `domain_name,notes,ssl_expires` (notes escaped per CSV rules).

### Database
Schema lives in **two places that must stay in sync**: `backend/init.sql` (mounted into the Postgres container via docker-compose) and `backend/src/init-db.js` (idempotent `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`, run on backend boot — this is the migration mechanism; there is no migration tool).
- `users`, `domains` (unique on `(user_id, domain_name)`; carries `ssl_renewal`, `cert_status`, `last_synced_at`), `certs` (CT issuance history, unique on `(domain_id, serial)`), `scans` (endpoint snapshots, unique on `(domain_id, host)`), plus reserved-for-future `teams`/`team_members`.

### Routing notes
- Vite proxies `/api` → `http://api:3001` (container service name) in dev; the frontend calls relative `/api/...` paths with `credentials: 'include'`.
- CORS allows `FRONTEND_URL` (default `http://localhost:5173`) with credentials.
- All `/api/domains` routes are behind `requireAuth`; user-scoping is enforced via `WHERE user_id = $1` on every query.

## Repo State Gotchas

- **`.gitignore` uses `.env`, `.env*`, and `.*`** — the `.*` pattern ignores all dotfiles. Since 2026-09-10 a trailing `!.env.example` negation exempts the environment template: **`.env.example` is tracked and committed** (make the repo cloneable). **`.kimchi/docs/` (all design/spec/review docs) is still NOT tracked** — use `git add -f` for new dotfiles there. `.kimchi/` is the project's design documentation (design-spec, implementation-plan, ssl-renewal-spec, csv-import-export-spec, review) — keep it around. The real `.env` (with OAuth secrets) remains excluded; the Postgres volume `trackrenewals_db-data` holds all user data locally and is never pushed.
- **`node_modules` for both backend (~3.4k files) and frontend (~2.3k files) is committed to git** — 5,700+ files in the repo. Consider `git rm -r --cached` + adding `node_modules` to `.gitignore`.
- `run.txt` is the canonical run recipe (`docker compose down` / `up --build`).
- JWT cookie is `secure: false` (commented out) — fine for local dev, must be enabled behind HTTPS in production.
