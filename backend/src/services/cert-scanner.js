// TLS endpoint scanner. Opens an outbound-only HTTPS handshake to a host and
// returns the certificate it *actually serves* — the ground truth that lets us
// detect "issued but never deployed" by comparing against CT issuance.

const tls = require('tls');
const crypto = require('crypto');
const { normalizeSerial } = require('./crt-sh');

function parseSAN(subjectaltname) {
  if (!subjectaltname) return [];
  return String(subjectaltname)
    .split(', ')
    .filter((entry) => entry.startsWith('DNS:'))
    .map((entry) => entry.slice(4));
}

function formatIssuer(issuer) {
  if (!issuer || typeof issuer !== 'object') return null;
  const parts = [];
  if (issuer.CN) parts.push(`CN=${issuer.CN}`);
  if (issuer.O) parts.push(`O=${issuer.O}`);
  if (issuer.C) parts.push(`C=${issuer.C}`);
  return parts.join(', ') || null;
}

// Returns null when the host is unreachable / not serving TLS.
// Returns { host, serial, common_name, sans[], issuer, not_before, not_after, chain_ok }
async function scanHost(hostname, { port = 443, timeoutMs = 6000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    try {
      const socket = tls.connect(
        { host: hostname, port, servername: hostname, timeout: timeoutMs, rejectUnauthorized: false },
        () => {
          try {
            // getPeerCertificate(true) includes `raw` (DER), so we can derive the
            // sha256 fingerprint that CertSpotter-style CT sources key on.
            const cert = socket.getPeerCertificate(true);
            const verified = socket.authorized;
            socket.end();
            if (!cert || !cert.valid_to) return done(null);
            const fingerprint = cert.raw
              ? crypto.createHash('sha256').update(cert.raw).digest('hex')
              : null;
            done({
              host: hostname,
              serial: normalizeSerial(cert.serialNumber),
              fingerprint,
              common_name: (cert.subject && cert.subject.CN) || null,
              sans: parseSAN(cert.subjectaltname),
              issuer: formatIssuer(cert.issuer),
              not_before: cert.valid_from ? new Date(cert.valid_from).toISOString() : null,
              not_after: cert.valid_to ? new Date(cert.valid_to).toISOString() : null,
              chain_ok: verified,
            });
          } catch (err) {
            socket.end();
            done(null);
          }
        }
      );

      socket.on('error', () => done(null));
      socket.on('timeout', () => {
        socket.destroy();
        done(null);
      });
    } catch (err) {
      done(null);
    }
  });
}

module.exports = { scanHost };
