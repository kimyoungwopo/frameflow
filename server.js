const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

function port(value, fallback) {
  const result = Number(value || fallback);
  if (!Number.isInteger(result) || result < 1 || result > 65535) throw new Error('WEB_PORT and BRIDGE_PORT must be ports from 1 to 65535');
  return result;
}
function available(value) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error(`Port ${value} is in use. Stop the existing project server or choose WEB_PORT / BRIDGE_PORT.`)));
    probe.listen(value, '127.0.0.1', () => probe.close(resolve));
  });
}

async function main() {
  const webPort = port(process.env.WEB_PORT || process.env.PORT, 4310);
  const bridgePort = port(process.env.BRIDGE_PORT, 4319);
  if (webPort === bridgePort) throw new Error('WEB_PORT and BRIDGE_PORT must be different');
  const dev = process.argv.includes('--dev');
  const webRoot = path.join(__dirname, 'web');
  const nextCli = path.join(webRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!fs.existsSync(nextCli)) throw new Error('Install web dependencies first: npm run setup');
  if (!dev && !fs.existsSync(path.join(webRoot, '.next', 'BUILD_ID'))) throw new Error('Build the web first: npm run build (or use npm run dev)');
  await Promise.all([available(webPort), available(bridgePort)]);
  const env = { ...process.env, WEB_PORT: String(webPort), BRIDGE_PORT: String(bridgePort) };
  if (env.FRAMEFLOW_SERVER_MODE === '1') {
    if (!env.FRAMEFLOW_PUBLIC_ORIGIN || new URL(env.FRAMEFLOW_PUBLIC_ORIGIN).protocol !== 'https:') throw new Error('Server mode requires FRAMEFLOW_PUBLIC_ORIGIN=https://your-test-host');
    env.FRAMEFLOW_SERVER_BRIDGE_KEY = crypto.randomBytes(32).toString('base64url');
    env.PROVIDER_PLAN_AUTH = 'codex';
  }
  const children = new Set();
  let stopping = false;
  let timer;
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) child.kill('SIGTERM');
    timer = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); }, 4000);
    timer.unref();
  };
  process.once('SIGINT', () => stop(0));
  process.once('SIGTERM', () => stop(0));
  const launch = (args, cwd) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
    children.add(child);
    child.once('error', (error) => { console.error(error.message); stop(1); });
    child.once('exit', (code, signal) => {
      children.delete(child);
      if (!stopping) { console.error(`A project service stopped (${signal || code}).`); stop(code || 1); }
      if (!children.size && timer) clearTimeout(timer);
    });
    return child;
  };
  launch([path.join(__dirname, 'bridge', 'server.js')], __dirname);
  const deadline = Date.now() + 15000;
  let ready = false;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${bridgePort}/health`, { signal: AbortSignal.timeout(1000) });
      const data = await response.json();
      if (response.ok && data.service === 'gpt-node-studio-bridge') { ready = true; break; }
    } catch (error) {
      if (!(error instanceof Error)) { stop(1); throw error; }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (stopping) return;
  if (!ready) { console.error('Local Bridge did not become ready.'); stop(1); return; }
  launch([nextCli, dev ? 'dev' : 'start', '--hostname', '127.0.0.1', '--port', String(webPort)], webRoot);
  console.log(`Web studio: http://127.0.0.1:${webPort}`);
}

if (require.main === module) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
module.exports = { port };
