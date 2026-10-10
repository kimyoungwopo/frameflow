const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AUTH_DIR = path.join(os.homedir(), '.gpt-node-studio', 'auth');
const SESSION_FILE = path.join(AUTH_DIR, 'session.enc');
const KEY_FILE = path.join(AUTH_DIR, 'session.key');
function loadKey() {
  if (process.env.BRIDGE_SESSION_KEY) return process.env.BRIDGE_SESSION_KEY;
  fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch {}
  const key = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(KEY_FILE, `${key}\n`, { mode: 0o600 });
  try { fs.chmodSync(KEY_FILE, 0o600); } catch {}
  return key;
}
const KEY = loadKey();

function configured() { return /^[A-Za-z0-9+/=]{43,}$/.test(KEY); }
function keyBytes() { return crypto.createHash('sha256').update(KEY).digest(); }
function ensureDir() { fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 }); try { fs.chmodSync(AUTH_DIR, 0o700); } catch {} }
function saveSession(session) {
  if (!configured()) throw new Error('session_key_not_configured');
  ensureDir();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
  const payload = JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') });
  const temp = `${SESSION_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, payload, { mode: 0o600 });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, SESSION_FILE);
}
function readSession() {
  if (!configured() || !fs.existsSync(SESSION_FILE)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch { return null; }
}
function clearSession() { try { fs.rmSync(SESSION_FILE, { force: true }); } catch {} }
function validSession(session) { return Boolean(session?.accessToken && Number.isFinite(session.expiresAt) && session.expiresAt > Date.now()); }
function status() { const session = readSession(); return { configured: configured(), authenticated: validSession(session), expiresAt: session?.expiresAt || null }; }
module.exports = { saveSession, readSession, clearSession, status, validSession, SESSION_FILE };
