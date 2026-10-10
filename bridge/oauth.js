const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const config = {
  authorizationUrl: process.env.PROVIDER_AUTHORIZATION_URL || 'https://auth.openai.com/oauth/authorize',
  tokenUrl: process.env.PROVIDER_TOKEN_URL || 'https://auth.openai.com/oauth/token',
  clientId: process.env.PROVIDER_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann',
  redirectUri: process.env.PROVIDER_REDIRECT_URI || `http://127.0.0.1:${process.env.BRIDGE_PORT || 4319}/auth/callback`,
  scope: process.env.PROVIDER_SCOPE || 'openid profile email offline_access api.connectors.read api.connectors.invoke',
  generateUrl: process.env.PROVIDER_GENERATE_URL || 'https://chatgpt.com/backend-api/codex/images/generations',
  editUrl: process.env.PROVIDER_EDIT_URL || 'https://chatgpt.com/backend-api/codex/images/edits',
  planUrl: process.env.PROVIDER_PLAN_URL || (process.env.PROVIDER_PLAN_AUTH === 'api-key' ? 'https://api.openai.com/v1/responses' : 'https://chatgpt.com/backend-api/codex/responses'),
  planModel: process.env.PROVIDER_PLAN_MODEL || 'gpt-6.1-sol',
  planAuth: process.env.PROVIDER_PLAN_AUTH || 'codex',
  deviceUsercodeUrl: process.env.PROVIDER_DEVICE_USERCODE_URL || 'https://auth.openai.com/api/accounts/deviceauth/usercode',
  deviceTokenUrl: process.env.PROVIDER_DEVICE_TOKEN_URL || 'https://auth.openai.com/api/accounts/deviceauth/token'};
function configured() { return Boolean(process.env.BRIDGE_SESSION_KEY || fs.existsSync(path.join(os.homedir(), '.gpt-node-studio', 'auth', 'session.key'))); }
function createPkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
function createState() { return crypto.randomBytes(24).toString('base64url'); }
function authorizationUrl(state, challenge) {
  if (!configured()) return null;
  const url = new URL(config.authorizationUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', 'codex_cli_rs');
  return url.toString();
}
async function exchangeCode(code, verifier) {
  const response = await fetch(config.tokenUrl, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: config.clientId, redirect_uri: config.redirectUri, code_verifier: verifier }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.access_token !== 'string') throw new Error('oauth_token_exchange_failed');
  let accountId = null;
  if (typeof body.id_token === 'string') { try { const payload = JSON.parse(Buffer.from(body.id_token.split('.')[1], 'base64url').toString('utf8')); accountId = payload.chatgpt_account_id || payload?.['https://api.openai.com/auth']?.chatgpt_account_id || payload.organizations?.[0]?.id || null; } catch {} }
  return { accessToken: body.access_token, refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null, accountId, expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000 };
}
async function startDeviceAuthorization() {
  const response = await fetch(config.deviceUsercodeUrl, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ client_id: config.clientId }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.device_auth_id !== 'string' || typeof (body.user_code || body.usercode) !== 'string') { const error = new Error('device_authorization_failed'); error.status = response.status || 502; throw error; }
  return { deviceAuthId: body.device_auth_id, userCode: body.user_code || body.usercode, intervalMs: Math.max(5000, Number(body.interval || 5) * 1000), expiresIn: Number(body.expires_in || 900) };
}
async function pollDeviceAuthorization(deviceAuthId, userCode) {
  const response = await fetch(config.deviceTokenUrl, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }) });
  const body = await response.json().catch(() => ({}));
  if (response.status === 403 || response.status === 404) return { pending: true };
  if (!response.ok || typeof body.authorization_code !== 'string' || typeof body.code_verifier !== 'string') { const error = new Error('device_token_failed'); error.status = response.status || 502; throw error; }
  const tokenResponse = await fetch(config.tokenUrl, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: body.authorization_code, client_id: config.clientId, redirect_uri: 'https://auth.openai.com/deviceauth/callback', code_verifier: body.code_verifier }) });
  const tokenBody = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || typeof tokenBody.access_token !== 'string') { const error = new Error('oauth_token_exchange_failed'); error.status = tokenResponse.status || 502; throw error; }
  let accountId = null;
  if (typeof tokenBody.id_token === 'string') { try { const payload = JSON.parse(Buffer.from(tokenBody.id_token.split('.')[1], 'base64url').toString('utf8')); accountId = payload.chatgpt_account_id || payload?.['https://api.openai.com/auth']?.chatgpt_account_id || payload.organizations?.[0]?.id || null; } catch {} }
  return { pending: false, session: { accessToken: tokenBody.access_token, refreshToken: typeof tokenBody.refresh_token === 'string' ? tokenBody.refresh_token : null, accountId, expiresAt: Date.now() + Number(tokenBody.expires_in || 3600) * 1000 } };
}
async function refreshSession(session) {
  if (!session.refreshToken) throw Object.assign(new Error('authentication_required'), { status: 401 });
  const response = await fetch(config.tokenUrl, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken, client_id: config.clientId }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.access_token !== 'string' || !body.access_token) throw Object.assign(new Error('authentication_required'), { status: 401 });
  const lifetime = Number(body.expires_in || 3600);
  if (!Number.isFinite(lifetime) || lifetime <= 0) throw Object.assign(new Error('authentication_required'), { status: 401 });
  return { ...session, accessToken: body.access_token, refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : session.refreshToken, expiresAt: Date.now() + lifetime * 1000 };
}
module.exports = { config, configured, createPkce, createState, authorizationUrl, exchangeCode, startDeviceAuthorization, pollDeviceAuthorization, refreshSession };
