#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const requiredDirs = [
  'docs/상태', 'docs/작업', 'docs/생각', 'docs/아이디어', 'docs/진행중', 'docs/완료'
];
const requiredFiles = ['AGENTS.md', 'docs/상태/README.md', 'package.json'];
const findings = [];

for (const rel of requiredFiles) {
  if (!fs.existsSync(path.join(root, rel))) findings.push(`missing:${rel}`);
}
for (const rel of requiredDirs) {
  if (!fs.existsSync(path.join(root, rel)) || !fs.statSync(path.join(root, rel)).isDirectory()) findings.push(`missing_dir:${rel}`);
}

const secretAssignment = /(API_KEY|TOKEN|PASSWORD|SECRET|CONNECTION_STRING)\\s*[=:]\\s*[^\\s`"']{8,}/i;
const ignored = new Set(['node_modules', '.next', '.git']);
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(full);
    else if (/\\.(md|mdx|json|cjs|js|ts|tsx)$/.test(entry.name)) {
      const text = fs.readFileSync(full, 'utf8');
      if (secretAssignment.test(text) && !text.includes('[REDACTED]')) findings.push(`possible_secret:${path.relative(root, full)}`);
    }
  }
}
scan(path.join(root, 'docs'));
const rootRules = path.join(root, 'AGENTS.md');
if (fs.existsSync(rootRules)) {
  const text = fs.readFileSync(rootRules, 'utf8');
  if (secretAssignment.test(text) && !text.includes('[REDACTED]')) findings.push('possible_secret:AGENTS.md');
}

const output = { ok: findings.length === 0, ruleFile: 'AGENTS.md', requiredDirs, findings };
console.log(JSON.stringify(output, null, 2));
process.exitCode = findings.length ? 1 : 0;
