// Isolated browser QA fixture: never uses the user's auth or a real provider.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const sharp = require('../web/node_modules/sharp');

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-web-qa-'));
  process.env.HOME = home;
  process.env.BRIDGE_SESSION_KEY = Buffer.alloc(32, 19).toString('base64');
  const { saveSession } = require('../bridge/session-store');
  saveSession({ accessToken: 'local-qa-fixture', expiresAt: Date.now() + 3600000 });
  const images = await Promise.all(['#8159da', '#35ad90', '#df9846'].map((background) => sharp({ create: { width: 128, height: 128, channels: 4, background } }).png().toBuffer()));
  const requests = [];
  const provider = http.createServer(async (req, res) => {
    if (req.url === '/qa/requests') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(requests)); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    requests.push({ path: req.url, prompt: payload.prompt, images: payload.images?.length || 0 });
    if (req.url === '/responses') {
      const graph = { summary: '모의 GPT 구성', warnings: [], nodes: [{ id: 1, type: 'prompt', prompt: 'QA image' }, { id: 2, type: 'generate', prompt: null }, { id: 3, type: 'preview', prompt: null }], edges: [{ source: 1, target: 2 }, { source: 2, target: 3 }] };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(graph) }] }] }));
      return;
    }
    if (process.env.QA_DELAY_MS) await new Promise(resolve => setTimeout(resolve, Number(process.env.QA_DELAY_MS)));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: images[(requests.length - 1) % images.length].toString('base64') }] }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${provider.address().port}`;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, WEB_PORT: process.env.WEB_PORT || '4320', BRIDGE_PORT: process.env.BRIDGE_PORT || '4329', PROVIDER_PLAN_URL: `${base}/responses`, PROVIDER_REDIRECT_URI: '', PROVIDER_TOKEN_URL: `${base}/token`, PROVIDER_GENERATE_URL: `${base}/generate`, PROVIDER_EDIT_URL: `${base}/edit`, PROVIDER_DEVICE_USERCODE_URL: `${base}/device`, PROVIDER_DEVICE_TOKEN_URL: `${base}/device-token` }, stdio: 'inherit',
  });
  console.log(`QA mock provider: ${base}/qa/requests`);
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  child.once('exit', (code) => { provider.close(); fs.rmSync(home, { recursive: true, force: true }); process.exitCode = code || 0; });
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
