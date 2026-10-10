const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { port } = require('../server');

test('startup validates numeric ports and defaults to the web port', () => {
  assert.equal(port(undefined, 4310), 4310);
  assert.equal(port('4320', 4310), 4320);
  for (const value of ['0', '-1', '65536', 'not-a-port', '1.5']) assert.throws(() => port(value, 4310));
});
test('a occupied web port is reported without terminating its owner', async () => {
  const owner = net.createServer();
  await new Promise((resolve) => owner.listen(0, '127.0.0.1', resolve));
  try {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, WEB_PORT: String(owner.address().port), BRIDGE_PORT: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
    let output = '';
    child.stderr.on('data', (chunk) => { output += chunk; });
    const code = await new Promise((resolve) => child.once('exit', resolve));
    assert.equal(code, 1);
    assert.match(output, /in use/);
    assert.equal(owner.listening, true);
  } finally { await new Promise((resolve) => owner.close(resolve)); }
});
