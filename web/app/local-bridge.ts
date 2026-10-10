const SETTINGS = 'frameflow-local-bridge-v1';
export type BridgeSettings = { url: string; key: string };
export function validateBridgeUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Bridge 주소는 http://127.0.0.1:포트 형식이어야 합니다.');
  return url.origin;
}
export function bridgeSettings(): BridgeSettings {
  const defaults = { url: 'http://127.0.0.1:4319', key: '' };
  try { const saved = JSON.parse(sessionStorage.getItem(SETTINGS) || 'null'); return saved ? { url: validateBridgeUrl(saved.url), key: String(saved.key || '') } : defaults; } catch { return defaults; }
}
export function saveBridgeSettings(settings: BridgeSettings) {
  sessionStorage.setItem(SETTINGS, JSON.stringify({ url: validateBridgeUrl(settings.url), key: settings.key.trim() }));
}
export function decodeSetupLink(hash: string): BridgeSettings | null {
  if (!hash.startsWith('#frameflow-connect=') || hash.length > 600) return null;
  try {
    const encoded = hash.slice('#frameflow-connect='.length);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    const value = JSON.parse(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')));
    const url = validateBridgeUrl(value.url);
    if (typeof value.key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.key)) return null;
    return { url, key: value.key };
  } catch { return null; }
}
export function acceptSetupLink(): boolean {
  const settings = decodeSetupLink(window.location.hash);
  if (!settings) return false;
  saveBridgeSettings(settings);
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  return true;
}
export async function localBridgeFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const routes: Record<string, string> = { '/status': '/api/bridge/status', '/auth/device/start': '/api/bridge/auth/device/start', '/auth/device/status': '/api/bridge/auth/device/status', '/auth/logout': '/api/bridge/auth/logout', '/v1/plan': '/api/workflow/plan', '/v1/edit': '/api/workflow/execute', '/v1/generate': '/api/workflow/execute' };
  if (!routes[path]) throw new Error('지원하지 않는 서버 요청입니다.');
  const signal = init.signal || AbortSignal.timeout(path.startsWith('/v1/') ? 245000 : 20000);
  let jobId: string | undefined;
  async function checked(response: Response) {
    try { await response.clone().json(); return response; }
    catch { return Response.json({ error: 'server_invalid_response', message: `서버 연결이 끊겼어요 (HTTP ${response.status}). 이미지 생성 요청을 자동으로 다시 보내지 않았습니다.` }, { status: 502 }); }
  }
  try {
    let response = await checked(await fetch(routes[path], { ...init, signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error' }));
    if (path === '/v1/edit' || path === '/v1/generate') {
      const data = await response.clone().json();
      if (response.ok && typeof data.jobId === 'string' && /^[A-Za-z0-9_-]{32}$/.test(data.jobId)) {
        jobId = data.jobId;
        for (;;) {
          signal.throwIfAborted();
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(signal.reason); };
            const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1500);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
          });
          response = await checked(await fetch(`${routes[path]}?job=${jobId}`, { method: 'GET', signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), credentials: 'same-origin', cache: 'no-store', redirect: 'error' }));
          const state = await response.clone().json();
          if (!response.ok || state.status !== 'running') break;
        }
      }
    }
    return response;
  }
  catch (error) {
    if (signal.aborted) {
      if (jobId) await fetch(`${routes[path]}?job=${jobId}`, { method: 'DELETE', credentials: 'same-origin', signal: AbortSignal.timeout(5000) }).catch(() => undefined);
      throw error;
    }
    throw new Error('테스트 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.');
  }
}
