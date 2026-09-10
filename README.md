# TrackRenewals — SSL Certificate Renewal Tracker & Domain SSL Monitor

> **Track SSL certificate renewals** across unlimited client domains.
> Agentless SSL cert monitoring via Certificate Transparency logs.
> Detect expired, expiring, and **issued-but-not-deployed** certificates — before your customers notice.

---

## Why TrackRenewals?

Every SSL certificate expires. When one does, the site goes down — silently and instantly.
For MSPs, web agencies, and anyone managing multiple domains, keeping track of SSL renewal dates across dozens (or hundreds) of clients is a nightmare:

- Certificates renew without anyone noticing they were never actually installed on the live server.
- Renewal dates get buried in email threads, login credentials nobody has anymore, and spreadsheet rows nobody updates.
- By the time someone notices, the site is already down.

**TrackRenewals solves all three problems** with one self-hosted tool:

| Problem | What TrackRenewals does |
|---|---|
| "When does this cert expire?" | Tracks SSL renewal dates for every domain in one dashboard, with per-domain expiry countdowns. |
| "Was the renewal actually deployed?" | Cross-references Certificate Transparency issuance logs against what the server is actually serving — flags **issued-but-not-deployed** renewals before expiry becomes an outage. |
| "I manage 200 client domains" | CSV import/export for bulk management; unlimited domains per account, all in one place. |

---

## Features

- **SSL Certificate Tracking** — Add domains, view expiry dates, filter by status (valid / expiring / expired / issued-not-deployed)
- **Certificate Transparency Monitoring** — Auto-discovers every cert ever issued for your domain via public CT logs (crt.sh + CertSpotter fallback)
- **Agentless TLS Endpoint Scanning** — No agents, no access to client servers needed; outbound-only TLS handshake reads what cert is actually being served
- **Issued-But-Not-Deployed Detection** — The signature alert: CT logs show a new cert was issued, but the server is still serving the old one — guaranteed outage when the old cert expires
- **Domain SSL Renewal Dashboard** — Stat cards (total / healthy / at-risk / expired), filterable domain list with status badges and expiry day counts
- **CSV Import / Export** — Bulk-add domains from a spreadsheet; export your entire portfolio to CSV anytime
- **Google OAuth Login** — One-click sign-in; no passwords to manage, no separate auth system
- **Self-Hosted, Private** — Your data stays on your infrastructure; no SaaS subscription, no external data sharing

---

## Quick Start

### Prerequisites

- Docker and Docker Compose
- A Google OAuth 2.0 credential (free to create at [console.cloud.google.com](https://console.cloud.google.com/apis/credentials))

### 1. Clone the repo

```bash
git clone https://github.com/systems1/trackrenewals.git
cd trackrenewals
```

### 2. Create your `.env` file

```bash
cp .env.example .env
```

Edit `.env` and set your credentials:

```
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
JWT_SECRET=any_random_string_here
```

### 3. Run

```bash
docker compose down
docker compose up --build
```

### 4. Open

| Service | URL |
|---|---|
| **Dashboard (frontend)** | [http://localhost:5173](http://localhost:5173) |
| **API (backend)** | [http://localhost:3001](http://localhost:3001) |
| **Health check** | [http://localhost:3001/api/health](http://localhost:3001/api/health) |

Click "Sign in with Google", add your first domain, and the cert engine runs automatically in the background.

---

## How It Works — Agentless Certificate Intelligence

TrackRenewals uses a **three-stage agentless pipeline** that requires no software on your clients' servers — just a domain name.

```
  ┌─────────────┐        ┌─────────────────┐        ┌───────────────────┐
  │  Stage 1     │        │  Stage 2         │        │  Stage 3           │
  │  CT Log      │───────▶│  TLS Endpoint   │───────▶│  Status            │
  │  Ingestion   │        │  Scan            │        │  Computation       │
  └─────────────┘        └─────────────────┘        └───────────────────┘
  crt.sh / CertSpotter    Outbound TLS handshake     Cross-references
  fetches every cert      reads served cert on        CT vs served cert
  ever issued for the     apex (domain) + www         to detect:
  domain (wildcards,                      • serial     • valid / expiring /
  subdomains included)                    • fingerprint   expired / unknown
                                          • SANs        • issued-but-not-
                                          • chain status    deployed
```

### Stage 1 — Certificate Transparency Log Ingestion (`crt.sh`)

When you add a domain (or trigger a manual refresh), TrackRenewals queries [crt.sh](https://crt.sh) — a public index of all certificates issued via Certificate Transparency logs — for the complete issuance history of that domain.

This catches:
- Wildcard certs (`*.example.com`)
- Subdomain certs (`api.example.com`, `app.example.com`)
- Certs issued by any CA (Let's Encrypt, DigiCert, Sectigo, etc.)
- Certs that were issued but never deployed

If crt.sh is down or flaky, the system falls back automatically to the [CertSpotter](https://sslmate.com/certspotter/) public issuances API.

### Stage 2 — TLS Endpoint Scanning

Outbound-only TLS handshakes are opened to the domain's apex and `www` subdomain. The scan reads:
- The certificate serial number and SHA-256 fingerprint
- Subject Alternative Names (SANs)
- Issuer details
- Validity window (`notBefore` / `notAfter`)
- TLS chain verification status

No software is installed on client servers — these are standard HTTPS connection attempts any browser would make.

### Stage 3 — Status Computation

The system cross-references what CT logs say was issued against what the server is actually serving. The result is one of six statuses:

| Status | Meaning | Risk |
|---|---|---|
| `valid` | Served cert is current and not near expiry | Healthy |
| `expiring` | Served cert expires within 30 days | ⚠️ At risk |
| `expired` | Served cert has already expired | 🔴 Critical |
| `issued-not-deployed` | CT shows a newer cert was issued, but server still serves an older one | 🔴 Critical — guaranteed outage when old cert expires |
| `scan-failed` | Certs were issued, but the server couldn't be reached (site down, DNS issue, TLS config error) | ⚠️ At risk |
| `unknown` | No CT records found and no endpoint data yet | Not evaluated |

**The key insight is `issued-not-deployed`**: someone ran `certbot` or `acme.sh`, the new cert was issued (CT logs prove it), but nobody installed it on the server. The old cert is still serving. When that old cert expires, the site goes down — and this is the hardest kind of failure to catch manually.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Docker Compose                                   │
│                                                                              │
│   ┌───────────────┐    ┌────────────────────┐    ┌────────────────────────┐  │
│   │  PostgreSQL 16 │    │  Express Backend    │    │  Vite / React          │  │
│   │  (port 5432)   │◀───│  (port 3001)        │◀───│  Frontend (port 5173)  │  │
│   │                │    │                     │    │                        │  │
│   │  users         │    │  Passport Google    │    │  Dashboard             │  │
│   │  domains       │    │  OAuth + JWT cookie │    │  DomainList            │  │
│   │  certs         │    │                     │    │  DomainForm            │  │
│   │  scans         │    │  cert-sync engine   │    │  CSV import/export     │  │
│   └───────────────┘    └────────────────────┘    └────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Auth**: Google OAuth 2.0 → httpOnly JWT cookie (`token`, 7-day). No sessions, no server-side state. `requireAuth` middleware verifies the JWT on every `/api/domains` request.
- **Backend entry**: `server.js` runs `initDb()` (idempotent `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS` — there is no migration tool) before starting Express.
- **Frontend proxy**: Vite proxies `/api` → `http://api:3001` (Docker service name) in dev.
- **CORS**: Allows `FRONTEND_URL` (default `http://localhost:5173`) with credentials.

---

## API Reference

All domain endpoints require authentication (the `token` cookie).

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/auth/me` | Get current user profile |
| `GET` | `/api/auth/google` | Redirect to Google OAuth login |
| `GET` | `/api/domains` | List all domains (includes `cert_count`) |
| `POST` | `/api/domains` | Add a domain (triggers background cert sync) |
| `PUT` | `/api/domains/:id` | Update domain notes |
| `DELETE` | `/api/domains/:id` | Delete a domain |
| `GET` | `/api/domains/:id/certs` | Get CT issuance history + served cert + status |
| `POST` | `/api/domains/:id/refresh` | Trigger a fresh CT + TLS scan |
| `POST` | `/api/domains/:id/refresh-ssl` | Legacy SSL date refresh (simple TLS check) |
| `POST` | `/api/domains/import` | Import domains from CSV (`multipart/form-data`, field `csvFile`) |
| `GET` | `/api/domains/export` | Export domains to CSV |
| `GET` | `/api/health` | Health check → `{ status: 'ok' }` |

### Example: Add a domain

```bash
curl -b "token=<JWT>" -X POST http://localhost:3001/api/domains \
  -H "Content-Type: application/json" \
  -d '{"domain_name": "example.com", "notes": "Client production site"}'
```

The domain is returned immediately. The cert sync (CT ingestion + TLS scan) runs in the background — the status transitions from `unknown` → the computed status once the scan completes.

### Example: View cert history for a domain

```bash
curl -b "token=<JWT>" http://localhost:3001/api/domains/1/certs
```

Returns: `{ domain, status, certs[], servedCert, last_synced_at }`

---

## Database Schema

Four user-facing tables, two reserved:

```
users
├── id, google_id, email, name, avatar_url, created_at, updated_at

domains
├── id, user_id (→ users), domain_name, notes
├── ssl_renewal        (TIMESTAMPTZ — last known expiry from served cert)
├── cert_status        (TEXT — valid/expiring/expired/issued-not-deployed/scan-failed/unknown)
├── last_synced_at     (TIMESTAMPTZ — when the cert engine last ran)
├── UNIQUE(user_id, domain_name)

certs
├── id, domain_id (→ domains)
├── serial, fingerprint, common_name, sans (JSONB), issuer
├── not_before, not_after
├── source ('ct'), first_seen, last_seen
├── UNIQUE(domain_id, serial)

scans
├── id, domain_id (→ domains), host
├── served_serial, served_fingerprint, served_common_name
├── served_not_after, served_issuer, chain_ok
├── scanned_at
├── UNIQUE(domain_id, host)

teams / team_members   (reserved for future use)
```

Schema is defined in two places that must stay in sync: `backend/init.sql` (mounted into Postgres on first boot) and `backend/src/init-db.js` (runs on every backend start, idempotent).

---

## Project Structure

```
trackrenewals/
├── backend/
│   ├── init.sql                         # Postgres schema (first-boot mount)
│   ├── src/
│   │   ├── server.js                    # Entry: runs initDb, starts Express
│   │   ├── db.js                        # pg Pool
│   │   ├── init-db.js                   # Idempotent table creation
│   │   ├── middleware/auth.js           # requireAuth JWT middleware
│   │   ├── routes/
│   │   │   ├── auth.js                  # Google OAuth + JWT cookie
│   │   │   └── domains.js              # All domain + cert endpoints
│   │   ├── services/                    # Certificate intelligence engine
│   │   │   ├── crt-sh.js               # CT log ingestion (crt.sh → CertSpotter)
│   │   │   ├── cert-scanner.js          # Outbound TLS endpoint scanner
│   │   │   ├── status.js               # Status computation (CT vs served)
│   │   │   └── cert-sync.js            # Orchestrator (CT + scan + persist)
│   │   └── utils/
│   │       └── ssl-checker.js           # Legacy simple TLS date check
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api.js                       # API client (relative /api paths)
│   │   ├── App.jsx                      # Router: Dashboard + Login
│   │   ├── context/AuthContext.jsx       # Session restore via /api/auth/me
│   │   └── components/
│   │       ├── Dashboard.jsx            # Stat cards, filters, domain list
│   │       ├── DomainList.jsx           # Domain cards + cert panels + status badges
│   │       ├── DomainForm.jsx           # Add / edit domain form
│   │       ├── LoginPage.jsx            # Google OAuth sign-in
│   │       └── Navbar.jsx               # Navigation bar
│   └── vite.config.js                  # /api proxy → http://api:3001
├── .kimchi/docs/                        # Design specs (untracked, add with git add -f)
│   ├── design-spec.md
│   ├── implementation-plan.md
│   ├── ssl-renewal-spec.md
│   ├── csv-import-export-spec.md
│   └── review.md
├── .env.example                         # Environment variable template
├── docker-compose.yml                   # PostgreSQL + Express + Vite
├── CLAUDE.md                            # AI assistant guide to the codebase
└── README.md
```

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth 2.0 client ID ([create here](https://console.cloud.google.com/apis/credentials)) |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth 2.0 client secret |
| `JWT_SECRET` | Yes | Any random string; used to sign the JWT session cookie |
| `DATABASE_URL` | No | Postgres connection string (defaults to `postgres://postgres:postgres@db:5432/domainnotes` inside Docker) |
| `FRONTEND_URL` | No | Frontend URL for CORS and OAuth redirect (defaults to `http://localhost:5173`) |

Without Google OAuth credentials, the app boots but login fails. All data stays local to your Postgres instance.

---

## Use Cases
**DevOps / Platform Teams**
Monitor SSL status for all production, staging, and internal domains. Detect cert drift (new issuance without deployment) that monitoring tools miss.

**Anyone Managing Multiple Domains**
If you own more than a handful of domains, TrackRenewals gives you a single source of truth for certificate health.

---

## Related Topics

`ssl renewal` · `track ssl certificates` · `ssl certificate monitoring` · `domain ssl monitor` · `certificate expiry tracker` · `ssl certificate management` · `certificate transparency logs` · `crt.sh` · `CertSpotter` · `issued but not deployed` · `ssl cert renewal tracker` · `manage ssl certificates` · `ssl monitoring tool` · `self-hosted ssl monitor` · `domain ssl renewal` · `certificate renewal dashboard` · `ssl certificate audit` · `agentless ssl monitoring` · `certbot renewal monitor` · `Let's Encrypt renewal tracker` · `multi-domain ssl management` · `MSP certificate management` · `ssl expiration alert`

---
