const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');

function setupOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error('Invalid setup website');
  return url.origin;
}
function connectionLink(origin, url, key) {
  return `${setupOrigin(origin)}/#frameflow-connect=${Buffer.from(JSON.stringify({ url, key })).toString('base64url')}`;
}
async function freePort() {
  for (let port = 4319; port <= 4349; port++) {
    const available = await new Promise(resolve => {
      const probe = net.createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error('No free local Bridge port. Close a previous Frameflow Bridge and try again.');
}
async function healthy(state) {
  try {
    const url = new URL(state.url);
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || !/^[A-Za-z0-9_-]{43}$/.test(state.key)) return false;
    const response = await fetch(`${url.origin}/status`, { headers: { Origin: state.origin, 'X-Frameflow-Key': state.key }, signal: AbortSignal.timeout(1500) });
    return response.ok && (await response.json()).bridge === 'gpt-node-studio-bridge';
  } catch { return false; }
}
async function prepare(directory) {
  const origin = setupOrigin(JSON.parse(fs.readFileSync(path.join(directory, 'site.json'), 'utf8')).origin);
  const stateFile = path.join(directory, 'setup-state.json');
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (saved.origin === origin && await healthy(saved)) return saved;
  } catch {}
  const port = await freePort();
  const key = crypto.randomBytes(32).toString('base64url');
  const log = fs.openSync(path.join(directory, 'bridge.log'), 'a', 0o600);
  const child = spawn(process.execPath, [path.join(directory, 'server.js')], {
    cwd: directory, detached: true, stdio: ['ignore', log, log],
    env: { ...process.env, BRIDGE_PORT: String(port), BRIDGE_ALLOWED_ORIGINS: origin, BRIDGE_PAIRING_KEY: key, BRIDGE_RETURN_URL: `${origin}/`, PROVIDER_REDIRECT_URI: `http://127.0.0.1:${port}/auth/callback`, PROVIDER_PLAN_AUTH: 'codex' },
  });
  fs.closeSync(log);
  child.unref();
  let spawnError;
  child.once('error', error => { spawnError = error; });
  const state = { origin, url: `http://127.0.0.1:${port}`, key, pid: child.pid };
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (await healthy(state)) {
      fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
      fs.chmodSync(stateFile, 0o600);
      return state;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  child.kill('SIGTERM');
  throw new Error('Bridge startup failed. See bridge.log in the setup folder.');
}
function openWebsite(url) {
  const command = process.platform === 'darwin' ? 'open' : 'rundll32.exe';
  const args = process.platform === 'darwin' ? [url] : ['url.dll,FileProtocolHandler', url];
  return new Promise((resolve, reject) => execFile(command, args, error => error ? reject(error) : resolve()));
}
async function main() {
  const directory = __dirname;
  const state = await prepare(directory);
  await openWebsite(connectionLink(state.origin, state.url, state.key));
  console.log('Frameflow is ready. Continue account connection in your browser. You can close this window.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { setupOrigin, connectionLink, freePort, healthy, prepare };
