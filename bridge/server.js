const http = require('node:http');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { config, configured, createPkce, createState, authorizationUrl, exchangeCode, startDeviceAuthorization, pollDeviceAuthorization } = require('./oauth');
const { saveSession, clearSession, status: sessionStatus } = require('./session-store');
const { execute, planWorkflow } = require('./provider-adapter');
const { executeWithSession, planWithSession } = require('./provider-adapter');
const { refreshSession } = require('./oauth');
const { createRemoteSessions } = require('./remote-sessions');
const remote = createRemoteSessions({ startDeviceAuthorization, pollDeviceAuthorization, refreshSession, executeWithSession, planWithSession });

const HOST = '127.0.0.1';
const PORT = Number(process.env.BRIDGE_PORT || 4319);
const PAIRING_KEY = process.env.BRIDGE_PAIRING_KEY || '';
const pending = new Map();
let deviceFlow = { status: 'idle', userCode: null, verificationUrl: 'https://auth.openai.com/codex/device', expiresAt: null, error: null };
const RETURN_URL = process.env.BRIDGE_RETURN_URL || `http://127.0.0.1:${process.env.WEB_PORT || 4310}/`;
let deviceGeneration = 0;
const callbackUrl = new URL(config.redirectUri);
if (callbackUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(callbackUrl.hostname) || callbackUrl.pathname !== '/auth/callback') throw new Error('PROVIDER_REDIRECT_URI must use a loopback HTTP /auth/callback URL');
const allowedOrigins = new Set([new URL(RETURN_URL).origin, `http://127.0.0.1:${PORT}`, ...String(process.env.BRIDGE_ALLOWED_ORIGINS || '').split(',').filter(Boolean).map(value => new URL(value.trim()).origin)]);
function trustedRequest(req) {
  let host;
  try { host = new URL(`http://${req.headers.host}`).hostname; } catch { return false; }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return false;
  return !req.headers.origin || allowedOrigins.has(req.headers.origin);
}

function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function isLocal(req) { const address = req.socket.remoteAddress || ''; return ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1'].includes(address); }
function readBody(req, limit = 32 * 1024 * 1024) { return new Promise((resolve, reject) => { let raw = ''; let size = 0; let rejected = false; req.setEncoding('utf8'); req.on('data', chunk => { if (rejected) return; size += Buffer.byteLength(chunk); if (size > limit) { rejected = true; req.resume(); reject(Object.assign(new Error('payload_too_large'), { status: 413 })); return; } raw += chunk; }); req.on('end', () => { if (!rejected) resolve(raw); }); req.on('error', error => { if (!rejected) reject(error); }); }); }
async function body(req) { try { const value = JSON.parse(await readBody(req)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_request'); return value; } catch (error) { throw Object.assign(new Error('invalid_request'), { status: error.status || 400 }); } }
function validateImageInput(input, kind) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) fail('prompt_required');
  if (input.prompt.trim().length > 16000) fail('prompt_too_long');
  const dataImage = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/;
  if (input.imageUrls !== undefined && (!Array.isArray(input.imageUrls) || input.imageUrls.some(value => typeof value !== 'string' || !dataImage.test(value)))) fail('image_payload_invalid');
  if (input.imageUrl !== undefined && input.imageUrl !== null && (typeof input.imageUrl !== 'string' || !dataImage.test(input.imageUrl))) fail('image_payload_invalid');
  const images = input.imageUrls?.length ? input.imageUrls : input.imageUrl ? [input.imageUrl] : [];
  if (images.length > 8) fail('too_many_images');
  if (kind === 'edit' && !images.length) fail('image_required');
  if (input.background !== undefined && !['transparent', 'white', 'black'].includes(input.background)) fail('background_invalid');
}
async function withClientSignal(req, res, action) {
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); };
  req.once('aborted', abort); res.once('close', abort);
  try { return await action(controller.signal); } finally { req.removeListener('aborted', abort); res.removeListener('close', abort); }
}
function errorMessage(error) { const messages = { provider_not_configured: '공식 OAuth와 provider 설정이 아직 없어요.', authentication_required: '먼저 공식 provider 로그인을 완료해 주세요.', provider_request_failed: 'provider 이미지 요청에 실패했어요.', provider_result_invalid: 'provider가 유효한 이미지 결과를 반환하지 않았어요.', oauth_token_exchange_failed: '공식 OAuth 토큰 교환에 실패했어요.', payload_too_large: '이미지 요청이 너무 커요. 이미지 크기를 줄인 뒤 다시 시도해 주세요.', workflow_plan_not_configured: 'GPT 워크플로우 구성 endpoint가 아직 설정되지 않았어요.', provider_plan_failed: 'GPT 워크플로우 구성 요청에 실패했어요.', provider_plan_invalid: 'GPT가 실행 가능한 플로우를 반환하지 않았어요. 설명을 구체적으로 바꿔 다시 구성해 주세요.', provider_plan_refused: 'GPT가 이 요청의 구성을 진행하지 못했어요. 작업 설명을 변경해 주세요.', provider_plan_rate_limited: 'GPT 사용 한도에 도달했어요. 잠시 후 다시 시도해 주세요.', provider_plan_forbidden: '이 계정에 GPT 구성 모델을 사용할 권한이 없어요.' }; return messages[error.message] || '요청을 처리하지 못했어요.'; }

async function beginDeviceFlow(authOverride = null) {
  const generation = deviceGeneration;
  const auth = authOverride || await startDeviceAuthorization();
  if (generation !== deviceGeneration) return;
  deviceFlow = { status: 'pending', userCode: auth.userCode, verificationUrl: 'https://auth.openai.com/codex/device', expiresAt: Date.now() + auth.expiresIn * 1000, error: null };
  const deadline = Date.now() + auth.expiresIn * 1000;
  while (Date.now() < deadline && deviceFlow.status === 'pending' && generation === deviceGeneration) {
    await new Promise((resolve) => setTimeout(resolve, auth.intervalMs));
    if (deviceFlow.status !== 'pending' || generation !== deviceGeneration) break;
    try {
      const result = await pollDeviceAuthorization(auth.deviceAuthId, auth.userCode);
      if (generation !== deviceGeneration) return;
      if (result.pending) continue;
      saveSession(result.session);
      deviceFlow = { ...deviceFlow, status: 'authenticated', error: null };
      return;
    } catch (error) {
      if (generation !== deviceGeneration) return;
      deviceFlow = { ...deviceFlow, status: 'error', error: error.message || 'device_login_failed' };
      return;
    }
  }
  if (generation === deviceGeneration && deviceFlow.status === 'pending') deviceFlow = { ...deviceFlow, status: 'expired', error: 'device_login_expired' };
}

const server = http.createServer(async (req, res) => {
  if (!isLocal(req)) return json(res, 403, { error: 'local_only' });
  if (!trustedRequest(req)) return json(res, 403, { error: 'untrusted_origin' });
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Frameflow-Key');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.writeHead(204); return res.end();
  }
  if (origin && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname) && (!PAIRING_KEY || req.headers['x-frameflow-key'] !== PAIRING_KEY)) return json(res, 401, { error: 'pairing_required' });
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (url.pathname.startsWith('/remote/')) {
      const expected = process.env.FRAMEFLOW_SERVER_BRIDGE_KEY;
      const received = req.headers['x-frameflow-server-key'];
      if (process.env.FRAMEFLOW_SERVER_MODE !== '1' || !expected || typeof received !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(received) || received.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) return json(res, 403, { error: 'server_bridge_forbidden' });
      const id = req.headers['x-frameflow-session'];
      if (url.pathname === '/remote/jobs' && ['GET', 'POST'].includes(req.method)) return json(res, 200, remote.imageJob(id, url.searchParams.get('job'), req.method === 'POST'));
      if (req.method === 'POST' && url.pathname === '/remote/session/new') return json(res, 200, { id: remote.create(String(req.headers['x-frameflow-client'] || 'local')) });
      if (req.method === 'GET' && url.pathname === '/remote/status') return json(res, 200, remote.status(id));
      if (req.method === 'POST' && url.pathname === '/remote/auth/device/start') return json(res, 200, await remote.startLogin(id));
      if (req.method === 'GET' && url.pathname === '/remote/auth/device/status') return json(res, 200, await remote.pollLogin(id));
      if (req.method === 'POST' && url.pathname === '/remote/auth/logout') return json(res, 200, remote.logout(id));
      if (req.method === 'POST' && ['/remote/v1/plan', '/remote/v1/edit', '/remote/v1/generate'].includes(url.pathname)) {
        const input = await body(req), action = url.pathname.split('/').pop();
        if (action === 'plan') {
          if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 8000) return json(res, 400, { error: 'workflow_prompt_invalid' });
        } else validateImageInput(input, action);
        const clean = { prompt: input.prompt.trim(), imageUrls: input.imageUrls || (input.imageUrl ? [input.imageUrl] : []), background: input.background };
        if (action !== 'plan') return json(res, 202, remote.submitImage(id, action, clean));
        return json(res, 200, await withClientSignal(req, res, signal => remote.run(id, action, clean, signal)));
      }
      return json(res, 404, { error: 'not_found' });
    }
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'gpt-node-studio-bridge', version: '0.2.0' });
    if (req.method === 'GET' && url.pathname === '/status') return json(res, 200, { bridge: 'gpt-node-studio-bridge', version: '0.2.0', authenticated: sessionStatus().authenticated, authSource: sessionStatus().authenticated ? 'project-session' : null, oauth: configured() ? 'configured' : 'not_configured', localOnly: true });
    if (req.method === 'POST' && url.pathname === '/auth/start') {
      if (!configured()) return json(res, 501, { error: 'oauth_not_configured', message: '공식 OAuth provider 설정이 필요해요.' });
      const pkce = createPkce(); const state = createState(); pending.set(state, { verifier: pkce.verifier, createdAt: Date.now() });
      return json(res, 200, { authorizationUrl: authorizationUrl(state, pkce.challenge), expiresIn: 600 });
    }
    if (req.method === 'POST' && url.pathname === '/auth/device/start') {
      if (!configured()) return json(res, 501, { error: 'oauth_not_configured', message: '공식 OAuth provider 설정이 필요해요.' });
      if (deviceFlow.status === 'pending') return json(res, 200, { ...deviceFlow, expiresIn: Math.max(0, Math.floor((deviceFlow.expiresAt - Date.now()) / 1000)) });
      const generation = ++deviceGeneration;
      const auth = await startDeviceAuthorization();
      if (generation !== deviceGeneration) return json(res, 409, { error: 'device_login_cancelled' });
      deviceFlow = { status: 'pending', userCode: auth.userCode, verificationUrl: 'https://auth.openai.com/codex/device', expiresAt: Date.now() + auth.expiresIn * 1000, error: null };
      beginDeviceFlow(auth).catch((error) => { deviceFlow = { ...deviceFlow, status: 'error', error: error.message || 'device_login_failed' }; });
      return json(res, 200, { ...deviceFlow, expiresIn: Math.max(0, Math.floor((deviceFlow.expiresAt - Date.now()) / 1000)) });
    }
    if (req.method === 'GET' && url.pathname === '/auth/device/status') return json(res, 200, { ...deviceFlow, authenticated: sessionStatus().authenticated, expiresIn: deviceFlow.expiresAt ? Math.max(0, Math.floor((deviceFlow.expiresAt - Date.now()) / 1000)) : 0 });
    if (req.method === 'GET' && url.pathname === '/auth/callback') {
      const state = url.searchParams.get('state'); const code = url.searchParams.get('code'); const item = state ? pending.get(state) : null;
      if (!item || Date.now() - item.createdAt > 600000) return json(res, 400, { error: 'oauth_state_invalid' });
      pending.delete(state); if (!code) return json(res, 400, { error: 'oauth_code_missing' });
      const generation = deviceGeneration;
      const session = await exchangeCode(code, item.verifier);
      if (generation !== deviceGeneration) return json(res, 409, { error: 'oauth_login_cancelled' });
      saveSession(session);
      res.writeHead(302, { Location: RETURN_URL, 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/auth/session-status') return json(res, 200, sessionStatus());
    if (req.method === 'POST' && url.pathname === '/auth/logout') { deviceGeneration++; deviceFlow = { status: 'idle', userCode: null, verificationUrl: null, expiresAt: null, error: null }; pending.clear(); clearSession(); return json(res, 200, { ok: true, authenticated: false }); }
    if (req.method === 'POST' && url.pathname === '/v1/plan') {
      const input = await body(req);
      if (typeof input.prompt !== 'string' || !input.prompt.trim()) return json(res, 400, { error: 'workflow_prompt_required', message: '워크플로우 구성을 위한 설명이 필요해요.' });
      if (input.prompt.trim().length > 8000) return json(res, 400, { error: 'workflow_prompt_too_long', message: '작업 설명은 8,000자 이하로 입력해 주세요.' });
      const result = await withClientSignal(req, res, signal => planWorkflow(input.prompt.trim(), signal));
      return json(res, 200, result);
    }
    if (req.method === 'POST' && (url.pathname === '/v1/generate' || url.pathname === '/v1/edit')) {
      const input = await body(req); const kind = url.pathname.endsWith('/edit') ? 'edit' : 'generate';
      validateImageInput(input, kind);
      const result = await withClientSignal(req, res, signal => execute(kind, input, signal)); return json(res, 200, result);
    }
    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    const responseBody = { error: error.message || 'bridge_request_failed', message: errorMessage(error) };
    if (error.message === 'provider_plan_invalid') {
      if (typeof error.planReason === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(error.planReason)) responseBody.planReason = error.planReason;
      if (Number.isSafeInteger(error.planNode) && error.planNode > 0) responseBody.planNode = error.planNode;
    }
    if (error.message === 'provider_request_failed') {
      if (Number.isInteger(error.providerStatus)) responseBody.providerStatus = error.providerStatus;
      if (error.providerCode) responseBody.providerCode = error.providerCode;
      if (error.providerParam) responseBody.providerParam = error.providerParam;
    }
    return json(res, error.status || 502, responseBody);
  }
});
function start() {
  server.on('error', error => { console.error(`Bridge could not listen on ${HOST}:${PORT}: ${error.code || error.message}`); process.exitCode = 1; });
  server.listen(PORT, HOST, () => console.log(`GPT Node Studio Bridge listening on http://${HOST}:${PORT}`));
  const callbackPort = Number(callbackUrl.port || 80);
  if (callbackPort !== PORT || callbackUrl.hostname === '[::1]') {
    const callbackServer = http.createServer((req, res) => {
      if (req.method !== 'GET' || new URL(req.url, config.redirectUri).pathname !== '/auth/callback') return json(res, 404, { error: 'not_found' });
      return server.emit('request', req, res);
    });
    callbackServer.on('error', error => { console.error(`OAuth callback could not listen on ${callbackUrl.host}: ${error.code || error.message}`); server.close(); process.exitCode = 1; });
    callbackServer.listen(callbackPort, callbackUrl.hostname === '[::1]' ? '::1' : HOST);
    server.on('close', () => callbackServer.close());
  }
  return server;
}
if (require.main === module) start();
module.exports = { server, start, trustedRequest, beginDeviceFlow };
