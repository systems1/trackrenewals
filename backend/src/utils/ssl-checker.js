const tls = require('tls');

function getSSLRenewalDate(hostname, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      const socket = tls.connect({
        host: hostname,
        port: 443,
        servername: hostname,
        timeout: timeoutMs,
      }, () => {
        try {
          const cert = socket.getPeerCertificate();
          socket.end();
          if (!cert || !cert.valid_to) {
            return resolve(null);
          }
          const date = new Date(cert.valid_to);
          if (isNaN(date.getTime())) {
            return resolve(null);
          }
          resolve(date.toISOString());
        } catch (err) {
          socket.end();
          resolve(null);
        }
      });

      socket.on('error', () => {
        resolve(null);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(null);
      });
    } catch (err) {
      resolve(null);
    }
  });
}

module.exports = { getSSLRenewalDate };
