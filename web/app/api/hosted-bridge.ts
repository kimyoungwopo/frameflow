import { createHash } from 'node:crypto';
import { bridgeUrl, readObject, RequestBodyError } from './bridge-client';

const COOKIE = 'frameflow_server_session';
const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;
type Options = { path: string; method: 'GET' | 'POST'; create?: boolean; logout?: boolean; operation?: 'plan' | 'image'; job?: string };
class BridgeFailure extends Error {
  constructor(readonly code: string, readonly status: number, readonly providerStatus?: number, readonly providerCode?: string, readonly planReason?: string, readonly planNode?: number) { super(code); }
}
function reply(data: Record<string, unknown>, status = 200, cookie?: string) {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (cookie) headers.set('Set-Cookie', cookie);
  return Response.json(data, { status, headers });
}
function cookieValue(request: Request, id: string, remove = false) {
  const hostname = new URL(`http://${request.headers.get('host') || new URL(request.url).host}`).hostname;
  const secure = !['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
  return `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${remove ? 0 : 28800}${secure ? '; Secure' : ''}`;
}
function sessionId(request: Request) {
  const match = (request.headers.get('cookie') || '').match(/(?:^|;\s*)frameflow_server_session=([A-Za-z0-9_-]{43})(?:;|$)/);
  return match?.[1];
}
function forbidden(request: Request) {
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site' || site === 'same-site') return true;
  const allowed = new Set([process.env.FRAMEFLOW_PUBLIC_ORIGIN, `http://127.0.0.1:${process.env.WEB_PORT || 4310}`, `http://localhost:${process.env.WEB_PORT || 4310}`].filter(Boolean));
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') || new URL(request.url).host;
  try {
    if (![...allowed].some(value => new URL(value as string).host === host)) return true;
    if (origin && (!allowed.has(origin) || new URL(origin).host !== host)) return true;
    return request.method !== 'GET' && !origin && site !== 'same-origin';
  } catch { return true; }
}
function reconstructionPrompt(prompt: string, failure: BridgeFailure): string | undefined {
  let envelope: Record<string, unknown> = { request: prompt };
  try {
    const parsed: unknown = JSON.parse(prompt);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof Reflect.get(parsed, 'request') === 'string') envelope = Object.fromEntries(Object.entries(parsed));
  } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  envelope.repair = { attempt: 1, validationCode: failure.planReason || 'structure', ...(failure.planNode === undefined ? {} : { nodeId: failure.planNode }) };
  const result = JSON.stringify(envelope);
  return result.length <= 8000 ? result : undefined;
}
async function rpc(request: Request, path: string, method: string, id?: string, payload?: Record<string, unknown>) {
  const headers: Record<string, string> = { 'X-Frameflow-Server-Key': process.env.FRAMEFLOW_SERVER_BRIDGE_KEY || '' };
  if (id) headers['X-Frameflow-Session'] = id;
  headers['X-Frameflow-Client'] = createHash('sha256').update(request.headers.get('cf-connecting-ip') || 'local-test').digest('hex');
  if (payload) headers['Content-Type'] = 'application/json';
  const timeout = path.endsWith('/plan') ? 125000 : /\/(edit|generate)$/.test(path) ? 245000 : 20000;
  const response = await fetch(bridgeUrl(path), { method, headers, body: payload ? JSON.stringify(payload) : undefined, cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(timeout)]) });
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BridgeFailure('bridge_invalid_response', 502);
  const data = Object.fromEntries(Object.entries(value));
  if (!response.ok) throw new BridgeFailure(typeof data.error === 'string' ? data.error : 'bridge_request_failed', response.status, typeof data.providerStatus === 'number' ? data.providerStatus : undefined, typeof data.providerCode === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(data.providerCode) ? data.providerCode : undefined, typeof data.planReason === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(data.planReason) ? data.planReason : undefined, typeof data.planNode === 'number' && Number.isSafeInteger(data.planNode) && data.planNode > 0 ? data.planNode : undefined);
  return data;
}
export async function hostedBridge(request: Request, options: Options) {
  if (process.env.FRAMEFLOW_SERVER_MODE !== '1' || !process.env.FRAMEFLOW_SERVER_BRIDGE_KEY) return reply({ error: 'local_bridge_required', message: '테스트 서버 모드가 활성화되지 않았습니다.' }, 410);
  if (forbidden(request)) return reply({ error: 'origin_forbidden' }, 403);
  let cookie: string | undefined;
  const started = Date.now();
  try {
    let id = sessionId(request);
    if (options.create) {
      if (!id || (await rpc(request, '/remote/status', 'GET', id)).sessionPresent !== true) {
        const created = await rpc(request, '/remote/session/new', 'POST');
        if (typeof created.id !== 'string' || !SESSION_ID.test(created.id)) throw new BridgeFailure('bridge_invalid_response', 502);
        id = created.id; cookie = cookieValue(request, id);
      }
    }
    if (options.logout) cookie = cookieValue(request, '', true);
    if (!id && options.path !== '/remote/status') return options.logout ? reply({ ok: true, authenticated: false }, 200, cookie) : reply({ error: 'authentication_required', message: '먼저 본인 계정을 연결해 주세요.' }, 401);
    let payload: Record<string, unknown> | undefined;
    let path = options.path;
    if (options.job !== undefined) {
      if (!/^[A-Za-z0-9_-]{32}$/.test(options.job)) throw new BridgeFailure('job_not_found', 404);
      path = `/remote/jobs?job=${options.job}`;
    }
    if (options.operation) {
      const state = await rpc(request, '/remote/status', 'GET', id);
      if (!state.canRun) throw new BridgeFailure('authentication_required', 401);
      payload = await readObject(request, options.operation === 'plan' ? 64 * 1024 : 32 * 1024 * 1024);
      if (options.operation === 'image') {
        if (payload.kind !== 'edit' && payload.kind !== 'generate') throw new BridgeFailure('invalid_operation', 400);
        path = `/remote/v1/${payload.kind}`;
      }
    }
    let data: Record<string, unknown>;
    try { data = await rpc(request, path, options.method, id, payload); }
    catch (error) {
      if (!(error instanceof BridgeFailure) || error.code !== 'provider_plan_invalid' || options.operation !== 'plan' || typeof payload?.prompt !== 'string' || request.signal.aborted) throw error;
      const prompt = reconstructionPrompt(payload.prompt, error), remaining = 120000 - (Date.now() - started);
      if (!prompt || remaining < 15000) throw error;
      const retry = new Request(request.url, { method: request.method, headers: request.headers, signal: AbortSignal.any([request.signal, AbortSignal.timeout(remaining)]) });
      data = await rpc(retry, path, options.method, id, { ...payload, prompt });
    }
    return reply(data, 200, cookie);
  } catch (error) {
    if (options.logout && error instanceof BridgeFailure && error.status === 401) return reply({ ok: true, authenticated: false }, 200, cookie);
    const blocked = error instanceof BridgeFailure && error.code === 'provider_request_failed' && error.providerCode === 'moderation_blocked';
    const planTimeout = options.operation === 'plan' && error instanceof Error && (error.name === 'TimeoutError' || error instanceof BridgeFailure && ['provider_plan_timeout', 'The operation was aborted due to timeout'].includes(error.code));
    const sourceStatus = planTimeout ? 504 : error instanceof BridgeFailure || error instanceof RequestBodyError ? error.status : 503;
    const status = blocked ? 422 : sourceStatus === 502 || sourceStatus === 504 ? 424 : sourceStatus;
    const code = planTimeout ? 'provider_plan_timeout' : blocked ? 'provider_moderation_blocked' : error instanceof BridgeFailure ? error.code : error instanceof RequestBodyError ? error.message : 'bridge_unavailable';
    if (options.operation === 'plan') console.warn('[workflow-plan] failure', { code: /^[a-z][a-z0-9_]{1,80}$/.test(code) ? code : 'unclassified', errorName: error instanceof Error ? error.name : 'unknown', upstreamStatus: sourceStatus, elapsedMs: Date.now() - started, upstreamTimeout: error instanceof BridgeFailure && /timeout|timed out/i.test(error.code), upstreamAbort: error instanceof BridgeFailure && /abort/i.test(error.code) });
    const messages: Record<string, string> = { authentication_required: '먼저 본인 계정을 연결해 주세요.', server_busy: '테스트 서버가 처리 중입니다. 잠시 후 다시 실행해 주세요.', login_rate_limited: '로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요.', payload_too_large: '이미지 요청이 너무 큽니다.', device_authorization_failed: 'GPT 인증 코드를 받지 못했습니다. 계정의 기기 인증 설정과 서버 연결을 확인해 주세요.', provider_plan_timeout: 'GPT 플로우 구성 시간이 초과됐어요. 기존 작업은 유지됩니다. 잠시 후 다시 구성하거나 요청을 작은 작업으로 나눠 주세요.', provider_plan_invalid: 'GPT가 만든 플로우의 입력·연결 검증에 실패했어요. 기존 플로우는 유지됩니다. 사진별 처리와 합성할 사진의 역할을 구체적으로 적거나, 수정할 범위를 작은 그룹으로 나눠 다시 요청해 주세요.', provider_plan_failed: 'GPT 플로우 구성 요청이 완료되지 않았어요. 잠시 후 다시 요청해 주세요.', provider_plan_refused: 'GPT가 이 작업의 플로우 구성을 거절했어요. 작업 설명을 바꿔 다시 요청해 주세요.', provider_plan_rate_limited: 'GPT 사용 한도에 도달했어요. 잠시 후 다시 요청해 주세요.', provider_plan_forbidden: '이 계정으로 GPT 플로우를 구성할 권한이 없습니다.', provider_request_failed: '이 계정의 이미지 요청이 실패했습니다. 제공자 권한과 사용 한도를 확인해 주세요.' };
    return reply({ error: code, message: blocked ? 'GPT 제공자가 이 이미지 또는 요청을 안전 정책으로 거절했습니다. 다른 이미지나 작업 설명으로 다시 시도해 주세요.' : messages[code] || '테스트 서버에서 요청을 처리하지 못했습니다. 연결 상태를 확인해 주세요.', ...(error instanceof BridgeFailure && error.providerCode ? { providerCode: error.providerCode } : {}) }, status, cookie);
  }
}
