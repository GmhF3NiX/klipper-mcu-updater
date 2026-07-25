const fs = require('fs');
const crypto = require('crypto');

// Streamt die Datei statt sie komplett in den Speicher zu laden — nötig, weil einzelne STLs
// hier über 80MB groß sind.
function hashFile(absPath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(absPath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

module.exports = { hashFile };
