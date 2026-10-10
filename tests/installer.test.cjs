const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildInstaller, SOURCES, crc32 } = require('../bridge/installer');
const { connectionLink, setupOrigin } = require('../bridge/setup-bootstrap');
require('./load-ts.cjs');
const { decodeSetupLink } = require('../web/app/local-bridge.ts');
const { GET } = require('../web/app/api/bridge/setup/route.ts');
function entries(archive) {
  const result = new Map(); let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const size = archive.readUInt32LE(offset + 18), length = archive.readUInt16LE(offset + 26);
    const name = archive.subarray(offset + 30, offset + 30 + length).toString();
    const data = archive.subarray(offset + 30 + length, offset + 30 + length + size);
    assert.equal(crc32(data), archive.readUInt32LE(offset + 14));
    result.set(name, data); offset += 30 + length + size;
  }
  return result;
}
const sources = Object.fromEntries(SOURCES.map(name => [name, fs.readFileSync(path.join(__dirname, '../bridge', name))]));
test('setup archives contain only current Bridge source, launchers and website settings', () => {
  for (const platform of ['mac', 'windows']) {
    const archive = buildInstaller(sources, platform, 'https://preview.example');
    const files = entries(archive);
    assert.equal(files.size, SOURCES.length + 3);
    for (const name of SOURCES) assert.deepEqual(files.get('Frameflow-Setup/bridge/' + name), sources[name]);
    assert.equal(JSON.parse(files.get('Frameflow-Setup/site.json')).origin, 'https://preview.example');
    assert.equal([...files.keys()].some(name => /session[.](enc|key)|\.env|setup-state/.test(name)), false);
    assert.equal(archive.subarray(-22).readUInt32LE(0), 0x06054b50);
    const launcher = files.get('Frameflow-Setup/' + (platform === 'mac' ? 'Start.command' : 'Start.cmd')).toString();
    const script = platform === 'mac' ? launcher : Buffer.from(launcher.match(/EncodedCommand ([A-Za-z0-9+/=]+)/)[1], 'base64').toString('utf16le');
    assert.match(script, /https:\/\/nodejs\.org\/dist\/latest-v22\.x/);
    assert.match(script, /checksum failed/);
    assert.doesNotMatch(script, /ExecutionPolicy|sudo|curl.+\|\s*(sh|bash)/);
  }
});
test('automatic connection uses URL fragment, rejects remote destinations and malformed keys', () => {
  const key = 'a'.repeat(43);
  const link = new URL(connectionLink('https://preview.example', 'http://127.0.0.1:4329', key));
  assert.equal(link.search, '');
  assert.deepEqual(decodeSetupLink(link.hash), { url: 'http://127.0.0.1:4329', key });
  assert.equal(decodeSetupLink(new URL(connectionLink('https://preview.example', 'https://evil.example', key)).hash), null);
  assert.equal(decodeSetupLink(new URL(connectionLink('https://preview.example', 'http://127.0.0.1:4329', 'bad')).hash), null);
  for (const origin of ['http://evil.example', 'https://site.example/path', 'https://user@site.example', 'https://site.example/?x=1']) assert.throws(() => setupOrigin(origin));
});
test('setup route never returns source archives, including direct URLs and forged local requests', async () => {
  const original = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = () => { reads++; throw new Error('Source must not be read'); };
  try {
    for (const query of ['', 'platform=mac&origin=https://preview.example', 'platform=windows&origin=https://preview.example', 'platform=mac&origin=http://127.0.0.1:4320']) {
      const response = await GET(new Request('https://preview.example/api/bridge/setup?' + query, { headers: { host: 'localhost', origin: 'http://localhost' } }));
      assert.equal(response.status, 410);
      assert.equal(response.headers.get('content-disposition'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal((await response.json()).error, 'source_delivery_disabled');
    }
    assert.equal(reads, 0);
  } finally { fs.readFileSync = original; }
});
