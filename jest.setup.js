const { webcrypto } = require('crypto');
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

process.env.OSC_ACCESS_TOKEN = 'foo';
