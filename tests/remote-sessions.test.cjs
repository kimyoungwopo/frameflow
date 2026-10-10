const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRemoteSessions } = require('../bridge/remote-sessions');
function fixture(overrides = {}) {
  let time = 100000, code = 0;
  const calls = [];
  const remote = createRemoteSessions({ now: () => time,
    startDeviceAuthorization: async () => ({ deviceAuthId: String(++code), userCode: String(code), expiresIn: 600, intervalMs: 1 }),
    pollDeviceAuthorization: async id => ({ session: { accessToken: `token-${id}`, refreshToken: `refresh-${id}`, expiresAt: time + 1000 } }),
    refreshSession: async session => ({ ...session, expiresAt: time + 1000 }),
    executeWithSession: async (kind, input, session) => { calls.push(session.accessToken); return { imageUrl: 'data:image/png;base64,AAAA', secret: session.accessToken }; },
    planWithSession: async (prompt, session) => { calls.push(session.accessToken); return { mode: 'gpt' }; }, ...overrides });
  return { remote, calls, advance: value => { time += value; }, login: async id => { await remote.startLogin(id); time += 2; await remote.pollLogin(id); } };
}
test('remote users have separate accounts, no unauthenticated fallback, and sanitized results', async () => {
  const f = fixture(), a = f.remote.create('a'), b = f.remote.create('b');
  await assert.rejects(f.remote.run(a, 'generate', {}), /authentication_required/);
  await f.login(a); await f.login(b);
  assert.equal(JSON.stringify(f.remote.status(a)).includes('token-'), false);
  assert.deepEqual(await f.remote.run(a, 'generate', {}), { imageUrl: 'data:image/png;base64,AAAA' });
  await f.remote.run(b, 'plan', { prompt: 'test' });
  assert.deepEqual(f.calls, ['token-1', 'token-2']);
  f.remote.logout(a);
  await assert.rejects(f.remote.run(a, 'generate', {}), /authentication_required/);
  assert.equal(f.remote.status(b).authenticated, true);
});
test('late login completion cannot revive a logged out account', async () => {
  let finish;
  const f = fixture({ pollDeviceAuthorization: () => new Promise(resolve => { finish = resolve; }) });
  const id = f.remote.create('a'); await f.remote.startLogin(id); f.advance(2);
  const polling = f.remote.pollLogin(id); f.remote.logout(id);
  finish({ session: { accessToken: 'private', expiresAt: 999999 } });
  await assert.rejects(polling, /authentication_required|login_cancelled/);
  assert.equal(f.remote.status(id).canRun, false);
});
test('expired sessions and creation rate limits reject requests', async () => {
  const f = fixture(), id = f.remote.create('a'); await f.login(id);
  for (let i = 0; i < 4; i++) f.remote.create('a');
  assert.throws(() => f.remote.create('a'), /login_rate_limited/);
  f.advance(8 * 60 * 60 * 1000);
  await assert.rejects(f.remote.run(id, 'generate', {}), /authentication_required/);
});
test('logout aborts in-flight operations even when a provider ignores abort', async () => {
  let finish;
  const f = fixture({ executeWithSession: () => new Promise(resolve => { finish = resolve; }) });
  const id = f.remote.create('a'); await f.login(id);
  const running = f.remote.run(id, 'generate', {}); await Promise.resolve();
  f.remote.logout(id); finish({ imageUrl: 'private-image' });
  await assert.rejects(running, /abort/i);
});
test('image submission returns before completion and jobs belong only to their session', async () => {
  let finish, executions = 0;
  const f = fixture({ executeWithSession: () => { executions++; return new Promise(resolve => { finish = resolve; }); } });
  const a = f.remote.create('a'), b = f.remote.create('b'); await f.login(a); await f.login(b);
  const submitted = f.remote.submitImage(a, 'generate', {});
  assert.equal(submitted.status, 'running');
  assert.deepEqual(f.remote.imageJob(a, submitted.jobId), { status: 'running' });
  assert.throws(() => f.remote.imageJob(b, submitted.jobId), /job_not_found/);
  await Promise.resolve(); finish({ imageUrl: 'completed-image' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.remote.imageJob(a, submitted.jobId), { status: 'done', imageUrl: 'completed-image' });
  assert.equal(executions, 1);
});
test('job cancellation and session expiry remove access to results', async () => {
  const f = fixture(), id = f.remote.create('a'); await f.login(id);
  const job = f.remote.submitImage(id, 'generate', {});
  assert.deepEqual(f.remote.imageJob(id, job.jobId, true), { cancelled: true });
  assert.throws(() => f.remote.imageJob(id, job.jobId), /job_not_found/);
  f.remote.logout(id);
  assert.throws(() => f.remote.imageJob(id, job.jobId), /authentication_required/);
});
test('background jobs retain safe provider refusal metadata', async () => {
  const f = fixture({ executeWithSession: async () => { throw Object.assign(new Error('provider_request_failed'), { status: 502, providerStatus: 400, providerCode: 'moderation_blocked' }); } });
  const id = f.remote.create('a'); await f.login(id);
  const job = f.remote.submitImage(id, 'edit', {}); await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => f.remote.imageJob(id, job.jobId), error => error.providerCode === 'moderation_blocked' && error.providerStatus === 400);
});
test('polled terminal jobs release cache capacity without weakening running limits or ownership', async () => {
  const f = fixture(), a = f.remote.create('a'), b = f.remote.create('b'); await f.login(a); await f.login(b);
  let first;
  for (let i = 0; i < 40; i++) {
    const job = f.remote.submitImage(a, 'generate', {}); first ||= job.jobId;
    await new Promise(resolve => setImmediate(resolve));
    assert.throws(() => f.remote.imageJob(b, job.jobId), /job_not_found/);
    assert.equal(f.remote.imageJob(a, job.jobId).status, 'done');
    assert.equal(f.remote.imageJob(a, job.jobId).status, 'done');
    if (i === 31) assert.equal(f.remote.imageJob(a, first).status, 'done');
  }
  assert.throws(() => f.remote.imageJob(a, first), /job_not_found/);
});
test('unread terminal jobs remain available and running admission stays bounded', async () => {
  const f = fixture(), id = f.remote.create('a'); await f.login(id); const jobs = [];
  for (let i = 0; i < 32; i++) { jobs.push(f.remote.submitImage(id, 'generate', {})); await new Promise(resolve => setImmediate(resolve)); }
  assert.throws(() => f.remote.submitImage(id, 'generate', {}), /server_busy/);
  assert.equal(f.remote.imageJob(id, jobs[0].jobId).status, 'done');
  f.remote.submitImage(id, 'generate', {});
  assert.equal(f.remote.imageJob(id, jobs[1].jobId).status, 'done');
  const completions = [], busy = fixture({ executeWithSession: () => new Promise(resolve => completions.push(resolve)) });
  const ids = ['a','b','c'].map(client => busy.remote.create(client)); for (const value of ids) await busy.login(value);
  for (const value of ids.slice(0,2)) {
    busy.remote.submitImage(value,'generate',{}); busy.remote.submitImage(value,'generate',{});
    assert.throws(() => busy.remote.submitImage(value,'generate',{}), /server_busy/);
  }
  assert.throws(() => busy.remote.submitImage(ids[0],'generate',{}), /server_busy/);
  assert.throws(() => busy.remote.submitImage(ids[2],'generate',{}), /server_busy/);
  await Promise.resolve(); completions.forEach(resolve => resolve({imageUrl:'result'})); await new Promise(resolve => setImmediate(resolve));
});
test('polled failed jobs also release capacity without losing safe error metadata', async () => {
  const f = fixture({ executeWithSession: async () => { throw Object.assign(new Error('provider_request_failed'), { status:502, providerCode:'moderation_blocked' }); } });
  const id = f.remote.create('a'); await f.login(id);
  for (let i=0;i<40;i++) {
    const job = f.remote.submitImage(id,'generate',{}); await new Promise(resolve => setImmediate(resolve));
    assert.throws(() => f.remote.imageJob(id,job.jobId), error => error.message === 'provider_request_failed' && error.providerCode === 'moderation_blocked');
  }
});
