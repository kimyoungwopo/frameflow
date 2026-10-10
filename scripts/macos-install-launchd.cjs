#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const project = path.resolve(__dirname, '..');
const label = 'com.frameflow.studio';
const agents = path.join(os.homedir(), 'Library', 'LaunchAgents');
const plist = path.join(agents, `${label}.plist`);
const script = path.join(project, 'scripts', 'macos-start.sh');
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${script}</string></array>
<key>WorkingDirectory</key><string>${project}</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ProcessType</key><string>Interactive</string>
<key>StandardOutPath</key><string>${project}/logs/launchd.stdout.log</string>
<key>StandardErrorPath</key><string>${project}/logs/launchd.stderr.log</string>
</dict></plist>`;
fs.mkdirSync(agents, { recursive: true });
fs.mkdirSync(path.join(project, 'logs'), { recursive: true });
fs.writeFileSync(plist, xml);
try { execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' }); } catch {}
execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist], { stdio: 'inherit' });
console.log(`installed ${plist}`);
console.log(`web: http://127.0.0.1:${process.env.WEB_PORT || 4310}`);
console.log('Quick Tunnel is intentionally not managed because its URL is ephemeral.');
