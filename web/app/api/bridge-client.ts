export function bridgeUrl(path: string): string {
  const port = Number(process.env.BRIDGE_PORT || 4319);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('BRIDGE_PORT must be a valid port');
  return `http://127.0.0.1:${port}${path}`;
}

export function foreignOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const url = new URL(request.url);
  const host = request.headers.get('host') || url.host;
  let requested: URL;
  try { requested = new URL(`${url.protocol}//${host}`); } catch { return true; }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(requested.hostname)) return true;
  return request.headers.get('sec-fetch-site') === 'cross-site' || (origin !== null && origin !== requested.origin);
}

export class RequestBodyError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function readObject(request: Request, limit: number): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError(400, 'invalid_request');
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new RequestBodyError(413, 'payload_too_large'); }
      text += decoder.decode(item.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) {
    if (error instanceof SyntaxError) throw new RequestBodyError(400, 'invalid_request');
    throw error;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new RequestBodyError(400, 'invalid_request');
  return Object.fromEntries(Object.entries(value));
}
