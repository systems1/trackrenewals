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

There is **no test suite and no linter** in this project. Backend `npm run dev`/`npm start` (nodemon/node), frontend `npm run build` (Vite). Host-side `vite build` needs Node 20+ (`crypto.getRandomValues`).

## Architecture

### Auth flow (cookie-based JWT, no sessions)
1. Frontend redirects to `GET /api/auth/google` → Passport Google OAuth
2. Callback (`GET /api/auth/google/callback`) upserts the user in `users`, signs a 7-day JWT, sets it as the `httpOnly` cookie named `token`, redirects to `FRONTEND_URL`
3. `requireAuth` middleware (`backend/src/middleware/auth.js`) verifies the cookie on every `/api/domains` route and attaches `req.user` — **the decoded JWT payload, not a DB row** (so `req.user.id` comes from the token)
4. `AuthContext` calls `/api/auth/me` on mount to restore the session

### SSL renewal tracking (the core feature)
- `backend/src/utils/ssl-checker.js` → `getSSLRenewalDate(hostname)` opens a `tls.connect({ port: 443 })` socket, reads `getPeerCertificate().valid_to`, returns ISO string or `null`. **Every error is swallowed and returns `null`** — SSL lookup must never crash or fail a request.
- Runs on **every** domain create/update (POST `/api/domains`, PUT `/api/domains/:id`), on the manual refresh endpoint (POST `/api/domains/:id/refresh-ssl`), and **per-row serially during CSV import** — large imports can be slow (5s timeout each).
- Stored in `domains.ssl_renewal TIMESTAMPTZ`; the DB keeps the last known value if a lookup fails.

### CSV import/export
- Import: `POST /api/domains/import` (multipart field `csvFile`, `multer` → `/tmp/`). Header auto-detected (first row containing "domain"), duplicates skipped via `ON CONFLICT DO NOTHING`, bad rows ignored, per-row SSL check.
- Export: `GET /api/domains/export` → `domains.csv` attachment with `domain_name,notes,ssl_expires` (notes escaped per CSV rules).

### Database
Schema lives in **two places that must stay in sync**: `backend/init.sql` (mounted into the Postgres container via docker-compose) and `backend/src/init-db.js` (idempotent `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`, run on backend boot — this is the migration mechanism; there is no migration tool).
- `users`, `domains` (unique on `(user_id, domain_name)`), plus reserved-for-future `teams`/`team_members`.

### Routing notes
- Vite proxies `/api` → `http://api:3001` (container service name) in dev; the frontend calls relative `/api/...` paths with `credentials: 'include'`.
- CORS allows `FRONTEND_URL` (default `http://localhost:5173`) with credentials.
- All `/api/domains` routes are behind `requireAuth`; user-scoping is enforced via `WHERE user_id = $1` on every query.

## Repo State Gotchas

- **`.gitignore` contains `.env`, `.env*`, and `.*`** — the `.*` pattern ignores all dotfiles. As a result, **`.kimchi/docs/` (all design/spec/review docs) and `.env.example` are NOT tracked in git.** Use `git add -f` to commit new dotfiles. `.kimchi/` is the project's design documentation (design-spec, implementation-plan, ssl-renewal-spec, csv-import-export-spec, review) — keep it around.
- **`node_modules` for both backend (~3.4k files) and frontend (~2.3k files) is committed to git** — 5,700+ files in the repo. Consider `git rm -r --cached` + adding `node_modules` to `.gitignore`.
- `run.txt` is the canonical run recipe (`docker compose down` / `up --build`).
- JWT cookie is `secure: false` (commented out) — fine for local dev, must be enabled behind HTTPS in production.
