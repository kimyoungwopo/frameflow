#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const textExtensions = new Set(['.md', '.mdx', '.json', '.cjs', '.js', '.ts', '.tsx', '.swift', '.sh', '.cmd', '.yml', '.yaml', '.toml', '.txt', '.html', '.css']);
const ignoredDirs = new Set(['node_modules', '.next', '.git', 'build', 'out', 'coverage', 'dist']);
const forbiddenFiles = [
  '.frameflow-server.env', '.env', '.env.local', '.env.production',
  'session.enc', 'session.key', 'cookies.json'
];
const patterns = [
  { name: 'personal home path', re: /\/Users\/[^\s`"']+/g },
  { name: 'live tunnel URL', re: /https?:\/\/[^\s`"']+\.(trycloudflare\.com|ngrok[^\s`"']*)/gi },
  { name: 'email address', re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { name: 'literal secret assignment', re: /\b(?:API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|CLIENT_SECRET|PASSWORD|CONNECTION_STRING|BRIDGE_PAIRING_KEY|BRIDGE_SESSION_KEY)\s*[=:]\s*["'`]([^"'`\n]{8,})["'`]/gi },

];
const allowedEmail = /(?:example\.(com|org|net)|\.example|chatgpt\.com)$/i;
const allowedLiteral = /^(?:replace-with|your-|test-|base64-or-random-secret|<|\[REDACTED\])/i;
const findings = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (forbiddenFiles.includes(entry.name) || /^\.env(?:\.|$)/.test(entry.name) && entry.name !== '.env.example') {
      findings.push(`${rel}: private environment/session file`);
      continue;
    }
    if (!textExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern.re)) {
        if (pattern.name === 'email address' && allowedEmail.test(match[0].split('@')[1])) continue;
        if (pattern.name === 'literal secret assignment' && allowedLiteral.test(match[1] || '')) continue;
        findings.push(`${rel}: ${pattern.name}: ${match[0].slice(0, 100)}`);
      }
    }
  }
}

walk(root);
const unique = [...new Set(findings)];
console.log(JSON.stringify({ ok: unique.length === 0, scannedRoot: root, findings: unique }, null, 2));
process.exitCode = unique.length ? 1 : 0;
