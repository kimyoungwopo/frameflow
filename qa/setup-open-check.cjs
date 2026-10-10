const fs = require('node:fs');
const childProcess = require('node:child_process');
const original = childProcess.execFile;
childProcess.execFile = function (command, args, callback) {
  if (command === 'open' && process.env.FRAMEFLOW_QA_LINK) {
    const url = new URL(args[0]);
    if (url.origin !== 'http://127.0.0.1:4320') throw new Error('QA expected a local website');
    fs.writeFileSync(process.env.FRAMEFLOW_QA_LINK, url.href, { mode: 0o600 });
    callback(null);
    return;
  }
  return original.apply(this, arguments);
};
