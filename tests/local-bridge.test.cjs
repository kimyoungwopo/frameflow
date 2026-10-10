const { test, after } = require('node:test');
const assert = require('node:assert/strict');
require('./load-ts.cjs');
const { localBridgeFetch, saveBridgeSettings, validateBridgeUrl, acceptSetupLink, bridgeSettings } = require('../web/app/local-bridge.ts');
const originalFetch = global.fetch;
const values = new Map();
global.sessionStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
after(() => { global.fetch = originalFetch; delete global.sessionStorage; });
test('Bridge targets accept only loopback and reject remote hosts, credentials and paths', () => {
  assert.equal(validateBridgeUrl('http://127.0.0.1:4329'), 'http://127.0.0.1:4329');
  for (const url of ['https://evil.example', 'http://192.168.1.2:4319', 'http://user@127.0.0.1:4319', 'http://127.0.0.1:4319/other', 'http://127.0.0.1:4319/?token=x']) assert.throws(() => validateBridgeUrl(url));
});
test('browser requests use the web server with session cookies and never contact loopback', async () => {
  saveBridgeSettings({ url: 'http://127.0.0.1:4329', key: 'local-key' });
  const calls = [];
  global.fetch = async (url, options) => { calls.push(url); assert.equal(options.credentials, 'same-origin'); assert.equal(options.targetAddressSpace, undefined); assert.equal(new Headers(options.headers).get('X-Frameflow-Key'), null); return new Response('{}'); };
  await localBridgeFetch('/auth/device/start', { method: 'POST' });
  await localBridgeFetch('/v1/plan', { method: 'POST' });
  await localBridgeFetch('/v1/edit', { method: 'POST' });
  assert.deepEqual(calls, ['/api/bridge/auth/device/start', '/api/workflow/plan', '/api/workflow/execute']);
  global.fetch = async url => { calls.push(url); throw new TypeError('offline'); };
  await assert.rejects(localBridgeFetch('/v1/generate'), /테스트 서버/);
  assert.equal(calls.length, 4);
  assert.equal(calls[3], '/api/workflow/execute');
});
test('unauthenticated server responses reach the login UI without local fallback', async () => {
  global.fetch = async () => new Response(JSON.stringify({ error: 'authentication_required' }), { status: 401 });
  assert.equal((await localBridgeFetch('/v1/plan')).status, 401);
  await assert.rejects(localBridgeFetch('/unknown'), /지원하지/);
});
test('tunnel HTML failures become an actionable JSON error instead of a parser crash', async () => {
  global.fetch = async () => new Response('<!DOCTYPE html><html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
  const response = await localBridgeFetch('/v1/generate');
  assert.equal(response.status, 502);
  const data = await response.json();
  assert.equal(data.error, 'server_invalid_response');
  assert.match(data.message, /HTTP 502/);
});
test('image requests submit once then retrieve completed jobs without resubmitting', async () => {
  const calls = [], job = 'j'.repeat(32);
  global.fetch = async (url, options) => { calls.push({ url, method: options.method }); return Response.json(options.method === 'POST' ? { jobId: job, status: 'running' } : { status: 'done', imageUrl: 'completed' }); };
  const response = await localBridgeFetch('/v1/generate', { method: 'POST', body: '{}' });
  assert.equal((await response.json()).imageUrl, 'completed');
  assert.deepEqual(calls, [{ url: '/api/workflow/execute', method: 'POST' }, { url: `/api/workflow/execute?job=${job}`, method: 'GET' }]);
});
test('setup return automatically saves connection settings and removes the key from the URL', () => {
  const settings = { url: 'http://127.0.0.1:4321', key: 'a'.repeat(43) };
  const encoded = Buffer.from(JSON.stringify(settings)).toString('base64url');
  let cleaned;
  global.window = { location: { hash: '#frameflow-connect=' + encoded, pathname: '/', search: '?test=1' }, history: { replaceState: (_state, _title, url) => { cleaned = url; } } };
  try { assert.equal(acceptSetupLink(), true); assert.deepEqual(bridgeSettings(), settings); assert.equal(cleaned, '/?test=1'); }
  finally { delete global.window; }
});
