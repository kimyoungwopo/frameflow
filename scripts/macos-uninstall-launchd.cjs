#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const label = 'com.frameflow.studio';
try { execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'inherit' }); } catch { process.exitCode = 1; }
