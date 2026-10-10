const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BYTES = 28 * 1024 * 1024;
function invalid() { return Object.assign(new Error('provider_result_invalid'), { status: 502 }); }
function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && [0, 168].includes(b)) && !(a === 198 && [18, 19, 51].includes(b)) && !(a === 203 && b === 0);
  }
  return net.isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^200[12]:/i.test(address);
}
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error || !addresses?.length || addresses.some(item => !publicAddress(item.address))) return callback(invalid());
    const selected = addresses[0];
    callback(null, ...(options.all ? [[selected]] : [selected.address, selected.family]));
  });
}
function imageData(bytes, mime) {
  const signature = bytes.subarray(0, 12);
  const detected = signature.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
    : signature[0] === 255 && signature[1] === 216 && signature[2] === 255 ? 'image/jpeg'
    : signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !detected || (mime === 'image/jpg' ? 'image/jpeg' : mime) !== detected) throw invalid();
  return `data:${detected};base64,${bytes.toString('base64')}`;
}
async function readProviderJson(response) {
  if (!response.body) throw invalid();
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > MAX_JSON_BYTES) throw invalid(); chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function normalizeProviderImage(item, endpoint, signal) {
  const raw = item?.b64_json || item?.base64;
  const mime = item?.mime_type || 'image/png';
  const value = item?.imageUrl || item?.image_url || item?.url || (typeof raw === 'string' && raw.startsWith('data:') ? raw : typeof raw === 'string' ? `data:${mime};base64,${raw}` : null);
  if (typeof value !== 'string') throw invalid();
  if (value.startsWith('data:')) {
    if (value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 40) throw invalid();
    const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match) throw invalid();
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.toString('base64') !== match[2]) throw invalid();
    return imageData(bytes, match[1]);
  }
  let url, allowed;
  try {
    url = new URL(value);
    allowed = new Set([new URL(endpoint).origin, ...String(process.env.PROVIDER_IMAGE_ORIGINS || '').split(',').filter(Boolean).map(origin => {
      const parsed = new URL(origin.trim());
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw invalid();
      return parsed.origin;
    })]);
  } catch { throw invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || net.isIP(url.hostname.replace(/^\[|\]$/g, '')) || !allowed.has(url.origin)) throw invalid();
  const timeout = AbortSignal.timeout(15000);
  const joined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  joined.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: 'image/png,image/jpeg,image/webp' }, lookup: publicLookup, signal: joined, agent: false }, response => {
      const mime = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (response.statusCode !== 200 || !['image/png','image/jpeg','image/jpg','image/webp'].includes(mime) || Number(response.headers['content-length'] || 0) > MAX_IMAGE_BYTES) { response.destroy(); reject(invalid()); return; }
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) { response.destroy(); reject(invalid()); } else chunks.push(chunk);
      });
      response.on('error', () => reject(joined.aborted ? joined.reason : invalid()));
      response.on('aborted', () => reject(invalid()));
      response.on('end', () => { try { resolve(imageData(Buffer.concat(chunks), mime)); } catch (error) { reject(error); } });
    });
    request.on('error', () => reject(joined.aborted ? joined.reason : invalid()));
  });
}
module.exports = { normalizeProviderImage, readProviderJson };
