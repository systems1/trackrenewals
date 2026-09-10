// Hostname normalization for the cert pipeline.
//
// Users enter domains free-form: "https://yahoo.com/", "www.yahoo.com",
// "YAHOO.COM.", "yahoo.com:443", "http://user@yahoo.com/x?q=1". None of those
// are usable as-is for a crt.sh query or a TLS connect. This reduces any
// plausible input to a bare lowercased hostname (apex or www), or null if the
// input can't be a hostname at all.

function normalizeHostname(input) {
  if (!input) return null;
  let raw = String(input).trim();
  if (!raw) return null;

  // Give URL a scheme so it parses (it requires one). Bare hosts and paths
  // both become "https://..." — the hostname is what we keep.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }

  let host;
  try {
    host = new URL(raw).hostname;
  } catch {
    // Unparseable (rare) — fall back to a manual strip: scheme, then anything
    // from the first slash, then a port.
    host = String(input).trim();
    host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    host = host.split(/[/?#]/)[0];
    host = host.replace(/:\d+$/, '');
  }

  host = host.toLowerCase();

  // Fully-qualified trailing dot ("yahoo.com.") is the same host without it.
  if (host.endsWith('.')) host = host.slice(0, -1);

  // A hostname cannot contain whitespace; reject anything that still does
  // (e.g. "foo bar" fell through the manual path).
  if (!host || /\s/.test(host)) return null;

  return host;
}

module.exports = { normalizeHostname };