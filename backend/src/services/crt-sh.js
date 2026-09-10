// Certificate Transparency ingestion with a resilient source chain.
// Given a domain, fetch every cert ever issued for it (including wildcard /
// subdomain certs). This is the "discover certs you didn't even know existed"
// half of the agentless pipeline.
//
// crt.sh is a free single-instance service that is frequently flaky (it has
// just returned 502 then 200 for the same query seconds apart), so we fall
// back to CertSpotter's public issuances endpoint when it fails.
//
// Identity is fuzzy because the two sources expose different keys:
//   - crt.sh      -> serial_number
//   - certspotter -> cert_sha256 fingerprint
// Callers (status.js) match the served cert by serial OR fingerprint.

const UA = 'trackrenewals-demo/0.1 (cert-management demo)';

function normalizeSerial(serial) {
  return (serial || '').toLowerCase().replace(/[^a-f0-9]/g, '');
}

function normalizeFingerprint(fp) {
  return (fp || '').toLowerCase().replace(/[^a-f0-9]/g, '');
}

// crt.sh returns ISO timestamps without a timezone suffix ("2026-05-04T08:00:00").
// They're logged in UTC, so normalize to ISO-8601-with-Z for Postgres TIMESTAMPTZ.
function toUTC(iso) {
  if (!iso) return null;
  const s = String(iso).trim();
  return /\d{2}:\d{2}:\d{2}$/.test(s) ? `${s}Z` : s;
}

function relevantToDomain(entry, domain, sans) {
  const domainLc = domain.toLowerCase();
  const names = [entry.common_name, ...(sans || [])].filter(Boolean);
  return names.some(
    (n) => n.toLowerCase() === domainLc || n.toLowerCase().endsWith(`.${domainLc}`)
  );
}

// ── Source 1: crt.sh ───────────────────────────────────────────────────────────
async function fetchFromCrtSh(domain, timeoutMs) {
  const url = new URL('https://crt.sh/');
  url.searchParams.set('q', `%.${domain}`);
  url.searchParams.set('output', 'json');

  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`crt.sh responded ${res.status}`);
  const raw = await res.json();
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => {
      const sans = String(entry.name_value || '').split('\n').map((n) => n.trim()).filter(Boolean);
      const commonName = entry.common_name || sans[0] || null;
      if (!relevantToDomain({ common_name: commonName }, domain, sans)) return null;
      const serial = normalizeSerial(entry.serial_number);
      if (!serial) return null;
      return {
        serial,
        fingerprint: null,
        common_name: commonName,
        sans,
        issuer: (entry.issuer_name || '').replace(/^CN=/, '').split(',')[0] || null,
        not_before: toUTC(entry.not_before),
        not_after: toUTC(entry.not_after),
      };
    })
    .filter(Boolean);
}

// ── Source 2: CertSpotter (public, unauthenticated) ────────────────────────────
async function fetchFromCertspotter(domain, timeoutMs) {
  const url = new URL('https://api.certspotter.com/v1/issuances');
  url.searchParams.set('domain', domain);
  url.searchParams.set('include_subdomains', 'true');
  // append() so BOTH expands survive — set() overwrites the previous value.
  url.searchParams.append('expand', 'dns_names');
  url.searchParams.append('expand', 'issuer');
  url.searchParams.set('limit', '100');

  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`certspotter responded ${res.status}`);
  const raw = await res.json();
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => {
      const sans = Array.isArray(entry.dns_names) ? entry.dns_names : [];
      const commonName = sans[0] || null;
      if (!relevantToDomain({ common_name: commonName }, domain, sans)) return null;
      const fingerprint = normalizeFingerprint(entry.cert_sha256);
      if (!fingerprint) return null;
      const issuer = entry.issuer && (entry.issuer.friendly_name || entry.issuer.name);
      return {
        // CertSpotter exposes a sha256 fingerprint but NO serial. The certs
        // table keys on serial (NOT NULL), so synthesize a stable identity key
        // from the fingerprint. status.js matches served certs by serial OR
        // fingerprint, so matching still works (the 'fp:' prefix can never
        // collide with a real serial).
        serial: `fp:${fingerprint}`,
        fingerprint,
        common_name: commonName,
        sans,
        issuer: (issuer || '').replace(/^CN=/, '').split(',')[0] || null,
        not_before: toUTC(entry.not_before),
        not_after: toUTC(entry.not_after),
      };
    })
    .filter(Boolean);
}

// ── Public entry point ─────────────────────────────────────────────────────────
// Tries crt.sh first; on any failure falls back to CertSpotter. Returns a
// deduplicated list, newest not_before first:
//   [{ serial, fingerprint, common_name, sans[], issuer, not_before, not_after }]
async function fetchCertsFromCT(domain, { timeoutMs = 20000 } = {}) {
  const source = domain.trim().toLowerCase();

  let certs;
  let sourceUsed;
  try {
    certs = await fetchFromCrtSh(source, timeoutMs);
    sourceUsed = 'crt.sh';
  } catch (err) {
    console.log(`[crt-sh] crt.sh failed (${err.message}); trying certspotter`);
    certs = await fetchFromCertspotter(source, timeoutMs);
    sourceUsed = 'certspotter';
  }

  // crt.sh can return 200 with an empty list when it has no results — that is a
  // valid answer, not a reason to fall over to the second source.
  if (sourceUsed === 'crt.sh' && certs.length === 0) {
    try {
      certs = await fetchFromCertspotter(source, timeoutMs);
      sourceUsed = 'certspotter';
    } catch (err) {
      console.log(`[crt-sh] certspotter fallback also failed (${err.message})`);
    }
  }

  // Dedupe by identity key (serial for crt.sh, fingerprint for certspotter).
  const seen = new Map();
  for (const c of certs) {
    const key = c.serial || c.fingerprint;
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, c);
  }

  const list = Array.from(seen.values());
  list.sort((a, b) => {
    const ta = a.not_before ? new Date(a.not_before).getTime() : 0;
    const tb = b.not_before ? new Date(b.not_before).getTime() : 0;
    return tb - ta;
  });

  console.log(`[crt-sh] ${source}: ${list.length} certs (source=${sourceUsed})`);
  return list.slice(0, 100);
}

module.exports = { fetchCertsFromCT, normalizeSerial, normalizeFingerprint, toUTC };
