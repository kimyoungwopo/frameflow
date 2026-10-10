const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-test-'));
process.env.HOME = home;
process.env.BRIDGE_SESSION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.PROVIDER_REDIRECT_URI = 'http://127.0.0.1:4319/auth/callback';
process.env.BRIDGE_RETURN_URL = 'http://127.0.0.1:3000/';
process.env.BRIDGE_ALLOWED_ORIGINS = 'https://preview.example';
process.env.BRIDGE_PAIRING_KEY = 'test-pairing-key';
const store = require('../session-store');
const oauth = require('../oauth');
const adapter = require('../provider-adapter');
let resolvePoll;
oauth.pollDeviceAuthorization = async () => new Promise(resolve => { resolvePoll = resolve; });
const { server, trustedRequest, beginDeviceFlow } = require('../server');
const originalFetch = global.fetch;
after(async () => { global.fetch = originalFetch; if (server.listening) await new Promise(resolve => server.close(resolve)); fs.rmSync(home, { recursive: true, force: true }); });

test('expired session is unauthenticated and cannot reach provider without refresh token', async () => {
  store.saveSession({ accessToken: 'expired', expiresAt: Date.now() - 1 });
  assert.equal(store.status().authenticated, false);
  global.fetch = async () => { throw new Error('provider must not be called'); };
  await assert.rejects(adapter.execute('generate', { prompt: 'test' }), { message: 'authentication_required', status: 401 });
});
test('expired token refresh rotates encrypted session before provider request', async () => {
  store.saveSession({ accessToken: 'old', refreshToken: 'refresh', accountId: 'account', expiresAt: 1 });
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(calls.length === 1 ? { access_token: 'new', refresh_token: 'rotated', expires_in: 3600 } : { data: [{ b64_json: 'iVBORw0KGgo=' }] }), { status: 200 });
  };
  const result = await adapter.execute('generate', { prompt: 'test' });
  assert.equal(result.imageUrl, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(calls[0].options.body.get('grant_type'), 'refresh_token');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer new');
  assert.equal(store.readSession().refreshToken, 'rotated');
  assert.equal(store.status().authenticated, true);
});
test('refresh rejection maps to 401 and sends no image request', async () => {
  store.saveSession({ accessToken: 'old', refreshToken: 'bad', expiresAt: 1 });
  let calls = 0;
  global.fetch = async () => { calls++; return new Response('{}', { status: 400 }); };
  await assert.rejects(adapter.execute('generate', {}), { message: 'authentication_required', status: 401 });
  assert.equal(calls, 1);
});
test('request trust rejects foreign Origin and DNS rebinding Host', () => {
  assert.equal(trustedRequest({ headers: { host: '127.0.0.1:4319' } }), true);
  assert.equal(trustedRequest({ headers: { host: '127.0.0.1:4319', origin: 'http://127.0.0.1:3000' } }), true);
  assert.equal(trustedRequest({ headers: { host: '127.0.0.1:4319', origin: 'https://evil.example' } }), false);
  assert.equal(trustedRequest({ headers: { host: 'evil.example:4319' } }), false);
});
test('logout invalidates pending device polling result', async () => {
  store.clearSession();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const run = beginDeviceFlow({ userCode: 'mock', deviceAuthId: 'mock', intervalMs: 1, expiresIn: 60 });
  while (!resolvePoll) await new Promise(resolve => setTimeout(resolve, 1));
  global.fetch = originalFetch;
  const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/logout`, { method: 'POST' });
  assert.equal(response.status, 200);
  resolvePoll({ pending: false, session: { accessToken: 'late', expiresAt: Date.now() + 60000 } });
  await run;
  assert.equal(store.readSession(), null);
});
function request(pathname, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: pathname, method: payload === undefined ? 'GET' : 'POST', headers }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject); req.end(payload === undefined ? undefined : JSON.stringify(payload));
  });
}
test('real HTTP requests reject untrusted Host/Origin and accept originless local traffic', async () => {
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/health', undefined, { Host: 'evil.example' })).status, 403);
  assert.equal((await request('/auth/logout', {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/health', undefined, { Origin: 'http://127.0.0.1:3000' })).status, 200);
});
test('hosted browser requires pairing key and explicit CORS permission', async () => {
  const origin = { Origin: 'https://preview.example' };
  assert.equal((await request('/status', undefined, origin)).status, 401);
  assert.equal((await request('/status', undefined, { ...origin, 'X-Frameflow-Key': 'wrong' })).status, 401);
  assert.equal((await request('/status', undefined, { ...origin, 'X-Frameflow-Key': 'test-pairing-key' })).status, 200);
  assert.equal((await request('/auth/logout', {}, { Origin: 'https://evil.example', 'X-Frameflow-Key': 'test-pairing-key' })).status, 403);
  const response = await new Promise(resolve => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/v1/plan', method: 'OPTIONS', headers: origin }, res => { res.resume(); res.on('end', () => resolve(res)); }); req.end();
  });
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['access-control-allow-origin'], origin.Origin);
  assert.equal(response.headers['access-control-allow-private-network'], 'true');
  assert.match(response.headers['access-control-allow-headers'], /X-Frameflow-Key/);
});
test('direct image endpoints reject malformed payloads before provider calls', async () => {
  const examples = [null, [], {}, { prompt: ' ' }, { prompt: 'x'.repeat(16001) }, { prompt: 'x', imageUrls: [null] }, { prompt: 'x', imageUrls: Array(9).fill('data:image/png;base64,YQ==') }, { prompt: 'x', background: 'invalid' }];
  for (const input of examples) assert.equal((await request('/v1/generate', input)).status, 400);
  assert.equal((await request('/v1/edit', { prompt: 'edit' })).body.error, 'image_required');
});
test('client disconnect aborts image provider request', async () => {
  store.saveSession({ accessToken: 'mock', expiresAt: Date.now() + 60000 });
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let aborted;
  const cancelled = new Promise(resolve => { aborted = resolve; });
  global.fetch = async (url, options) => {
    entered();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { aborted(); reject(options.signal.reason); }, { once: true }));
  };
  const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/v1/generate', method: 'POST' });
  req.on('error', () => {}); req.end(JSON.stringify({ prompt: 'test' }));
  await started; req.destroy();
  await Promise.race([cancelled, new Promise((resolve, reject) => setTimeout(() => reject(new Error('provider was not cancelled')), 1000))]);
});
test('configured callback port conflict exits cleanly with EADDRINUSE', async () => {
  const blocker = http.createServer();
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  try {
    const child = spawn(process.execPath, [path.join(__dirname, '../server.js')], { env: { ...process.env, HOME: home, BRIDGE_PORT: '0', PROVIDER_REDIRECT_URI: `http://127.0.0.1:${blocker.address().port}/auth/callback` }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(code, 1); assert.match(stderr, /EADDRINUSE/);
  } finally { await new Promise(resolve => blocker.close(resolve)); }
});
test('GPT planning sends a structured Responses request using project auth', async () => {
  // Given
  store.saveSession({ accessToken: 'planner-token', accountId: 'planner-account', expiresAt: Date.now() + 60000 });
  const graph = { summary: '생성 계획', warnings: [], nodes: [{ id: 1, type: 'prompt', prompt: 'cat' }, { id: 2, type: 'generate', prompt: null }, { id: 3, type: 'preview', prompt: null }], edges: [{ source: 1, target: 2 }, { source: 2, target: 3 }] };
  let sent;
  global.fetch = async (url, options) => {
    sent = { url, headers: options.headers, body: JSON.parse(options.body) };
    const response = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(graph) }] }] };
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  // When
  const result = await adapter.planWorkflow('test planning');
  // Then
  assert.equal(result.mode, 'gpt'); assert.equal(result.model, oauth.config.planModel);
  assert.equal(sent.url, oauth.config.planUrl);
  assert.equal(sent.headers.Authorization, 'Bearer planner-token');
  assert.equal(sent.body.stream, true); assert.equal(sent.body.store, false);
  assert.deepEqual(sent.body.reasoning, { effort: 'low' });
  assert.equal(sent.body.text.format.type, 'json_schema'); assert.equal(sent.body.text.format.strict, true);
  assert.equal(result.nodes.length, 3);
});
test('GPT rate limit is returned without retry or keyword fallback', async () => {
  // Given
  store.saveSession({ accessToken: 'mock', expiresAt: Date.now() + 60000 });
  let calls = 0; global.fetch = async () => { calls++; return new Response('{}', { status: 429 }); };
  // When / Then
  await assert.rejects(adapter.planWorkflow('cat'), { message: 'provider_plan_rate_limited', status: 429 });
  assert.equal(calls, 1);
});
test('disconnecting GPT planning cancels the Responses request', async () => {
  // Given
  store.saveSession({ accessToken: 'mock', expiresAt: Date.now() + 60000 });
  let enter, cancel;
  const started = new Promise(resolve => { enter = resolve; });
  const cancelled = new Promise(resolve => { cancel = resolve; });
  global.fetch = async (_url, options) => {
    enter(); return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { cancel(); reject(options.signal.reason); }, { once: true }));
  };
  const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/v1/plan', method: 'POST' });
  req.on('error', () => {}); req.end(JSON.stringify({ prompt: 'planning' })); await started;
  // When
  req.destroy();
  // Then
  await Promise.race([cancelled, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('planner did not abort')), 1000))]);
});
