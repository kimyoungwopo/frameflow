const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const dns = require('node:dns');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const storePath = require.resolve('../session-store');
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { validSession: () => true, readSession: () => ({ accessToken: 'mock', expiresAt: Date.now() + 60000 }) } };
const { executeWithSession } = require('../provider-adapter');
const { config } = require('../oauth');
const original = { fetch: global.fetch, get: https.get, lookup: dns.lookup, origins: process.env.PROVIDER_IMAGE_ORIGINS };
after(() => { global.fetch = original.fetch; https.get = original.get; dns.lookup = original.lookup; if (original.origins === undefined) delete process.env.PROVIDER_IMAGE_ORIGINS; else process.env.PROVIDER_IMAGE_ORIGINS = original.origins; });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6xkAAAAASUVORK5CYII=', 'base64');
const data = `data:image/png;base64,${png.toString('base64')}`;
function mocks({ url = 'https://chatgpt.com/generated.png', bytes = png, type = 'image/png', status = 200, address = '93.184.216.34', length, stall = false } = {}) {
  let downloads = 0;
  global.fetch = async () => Response.json({ data: [{ url }] });
  dns.lookup = (_host, _options, callback) => callback(null, [{ address, family: address.includes(':') ? 6 : 4 }]);
  https.get = (target, options, callback) => {
    downloads++; assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers['chatgpt-account-id'], undefined);
    const req = new EventEmitter(); req.destroy = error => { if (error) req.emit('error', error); };
    options.signal.addEventListener('abort', () => req.destroy(options.signal.reason), { once: true });
    process.nextTick(() => options.lookup(target.hostname, {}, (error) => {
      if (error) return req.emit('error', error);
      if (stall) return;
      const response = Readable.from(Array.isArray(bytes) ? bytes : [bytes]);
      response.statusCode = status; response.headers = { 'content-type': type, ...(length === undefined ? {} : { 'content-length': String(length) }) };
      callback(response);
    }));
    return req;
  };
  return () => downloads;
}
const run = signal => executeWithSession('generate', { prompt: 'test' }, { accessToken: 'mock', accountId: 'mock' }, signal);
test('provider HTTPS output becomes input-compatible data without bearer credentials', async () => {
  const calls = mocks(); const result = await run(); assert.equal(result.imageUrl, data); assert.equal(calls(), 1);
  assert.match(result.imageUrl, /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/);
  let sent;
  global.fetch = async (_url, options) => { sent = JSON.parse(options.body); return Response.json({ data: [{ b64_json: png.toString('base64') }] }); };
  await executeWithSession('edit', { prompt: 'next', imageUrls: [result.imageUrl] }, { accessToken: 'mock' });
  assert.equal(sent.images[0].image_url, data);
});
test('untrusted, non-HTTPS and credential URLs are rejected before download', async () => {
  for (const url of ['https://evil.example/image.png', 'http://chatgpt.com/image.png', 'https://user:pass@chatgpt.com/image.png', 'https://127.0.0.1/image.png']) {
    const calls = mocks({ url }); await assert.rejects(run(), /provider_result_invalid/); assert.equal(calls(), 0);
  }
});
test('explicit origin enables signed CDN URL but DNS private addresses and redirects remain blocked', async () => {
  process.env.PROVIDER_IMAGE_ORIGINS = 'https://images.example';
  mocks({ url: 'https://images.example/result?signature=test' }); assert.equal((await run()).imageUrl, data);
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', '::ffff:127.0.0.1', 'fc00::1']) {
    mocks({ address }); await assert.rejects(run(), /provider_result_invalid/);
  }
  const calls = mocks({ status: 302 }); await assert.rejects(run(), /provider_result_invalid/); assert.equal(calls(), 1);
  delete process.env.PROVIDER_IMAGE_ORIGINS;
});
test('invalid MIME/signature, empty and oversized streamed images fail with bounded errors', async () => {
  for (const options of [{type:'text/html'}, {bytes:Buffer.from('not an image')}, {bytes:Buffer.alloc(0)}, {length:21*1024*1024}, {bytes:[Buffer.alloc(10*1024*1024),Buffer.alloc(11*1024*1024)]}]) {
    mocks(options); await assert.rejects(run(), /provider_result_invalid/);
  }
});
test('download obeys caller cancellation and sets its own finite deadline', async () => {
  mocks({stall:true}); const controller = new AbortController(); const pending = run(controller.signal);
  setImmediate(() => controller.abort()); await assert.rejects(pending, /abort/i);
});
test('stalled download is terminated by its 15-second total deadline', async () => {
  const originalTimeout = AbortSignal.timeout; let timed = false;
  AbortSignal.timeout = ms => { if (ms === 15000) { timed = true; return originalTimeout(10); } return originalTimeout(ms); };
  const keepAlive = setTimeout(() => {}, 100);
  try { mocks({stall:true}); await assert.rejects(run(), /timeout/i); assert.equal(timed, true); }
  finally { clearTimeout(keepAlive); AbortSignal.timeout = originalTimeout; }
});
test('provider JSON and inline base64 outputs enforce byte and format limits', async () => {
  mocks(); global.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(29*1024*1024)); controller.close(); } }));
  await assert.rejects(run(), /provider_result_invalid/);
  for (const result of [{b64_json:'invalid'}, {b64_json:png.toString('base64'),mime_type:'image/webp'}, {imageUrl:'data:image/svg+xml;base64,PHN2Zz4='}]) {
    global.fetch = async () => Response.json({data:[result]}); await assert.rejects(run(), /provider_result_invalid/);
  }
  for (const [mime, bytes] of [['image/jpeg',Buffer.from([255,216,255,224])],['image/webp',Buffer.from('RIFF0000WEBP')]]) {
    global.fetch = async () => Response.json({data:[{b64_json:bytes.toString('base64'),mime_type:mime}]});
    assert.equal((await run()).imageUrl, `data:${mime};base64,${bytes.toString('base64')}`);
  }
});
test('normalized URL result passes the actual bridge edit request validation', async () => {
  mocks(); const image = (await run()).imageUrl;
  const previousKey = process.env.BRIDGE_SESSION_KEY; process.env.BRIDGE_SESSION_KEY = 'test-only-key';
  try {
    const { server } = require('../server'); let submitted;
    global.fetch = async (_url, options) => { submitted = JSON.parse(options.body); return Response.json({data:[{b64_json:png.toString('base64')}]}); };
    const response = await new Promise(resolve => {
      const req = new EventEmitter(), res = new EventEmitter();
      Object.assign(req, {method:'POST',url:'/v1/edit',headers:{host:'127.0.0.1:4319'},socket:{remoteAddress:'127.0.0.1'},setEncoding(){},resume(){}});
      Object.assign(res, {writableEnded:false,setHeader(){},writeHead(status){this.status=status;},end(body){this.writableEnded=true;resolve({status:this.status,body:JSON.parse(body)});}});
      server.emit('request',req,res); req.emit('data',JSON.stringify({prompt:'next edit',imageUrls:[image]})); req.emit('end');
    });
    assert.equal(response.status,200); assert.equal(response.body.imageUrl,data); assert.equal(submitted.images[0].image_url,data);
  } finally { if (previousKey === undefined) delete process.env.BRIDGE_SESSION_KEY; else process.env.BRIDGE_SESSION_KEY = previousKey; }
});
