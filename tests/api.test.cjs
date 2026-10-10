const { test, after } = require('node:test');
const assert = require('node:assert/strict');
require('./load-ts.cjs');
const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; });
test('published server cannot use or expose the host Bridge even with forged local headers', async () => {
  const previousMode = process.env.FRAMEFLOW_SERVER_MODE;
  const previousKey = process.env.FRAMEFLOW_SERVER_BRIDGE_KEY;
  delete process.env.FRAMEFLOW_SERVER_MODE;
  delete process.env.FRAMEFLOW_SERVER_BRIDGE_KEY;
  try {
    let calls = 0;
    global.fetch = async () => { calls++; throw new Error('host Bridge must not be called'); };
    for (const [path, method] of [['workflow/execute', 'POST'], ['workflow/plan', 'POST'], ['bridge/status', 'GET'], ['bridge/auth/start', 'POST'], ['bridge/auth/device/start', 'POST'], ['bridge/auth/device/status', 'GET']]) {
      const route = require('../web/app/api/' + path + '/route.ts');
      const response = await route[method](new Request('http://localhost/api/' + path, { method, headers: { host: 'localhost', origin: 'http://localhost' } }));
      assert.equal(response.status, 410);
      assert.equal((await response.json()).error, 'local_bridge_required');
    }
    assert.equal(calls, 0);
  } finally {
    if (previousMode === undefined) delete process.env.FRAMEFLOW_SERVER_MODE; else process.env.FRAMEFLOW_SERVER_MODE = previousMode;
    if (previousKey === undefined) delete process.env.FRAMEFLOW_SERVER_BRIDGE_KEY; else process.env.FRAMEFLOW_SERVER_BRIDGE_KEY = previousKey;
  }
});
