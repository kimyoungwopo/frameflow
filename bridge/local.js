const crypto = require('node:crypto');

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--origin') {
  console.error('Usage: node bridge/local.js --origin https://your-test-site.example');
  process.exitCode = 1;
} else {
  const site = new URL(args[1]);
  if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/' || site.search || site.hash) throw new Error('Use the exact HTTPS website origin, without a path.');
  process.env.BRIDGE_ALLOWED_ORIGINS = site.origin;
  process.env.BRIDGE_PAIRING_KEY = crypto.randomBytes(32).toString('base64url');
  console.log(`Allowed website: ${site.origin}`);
  console.log(`Local Bridge: http://127.0.0.1:${process.env.BRIDGE_PORT || 4319}`);
  console.log(`Connection key (paste into that website only): ${process.env.BRIDGE_PAIRING_KEY}`);
  require('./server').start();
}
