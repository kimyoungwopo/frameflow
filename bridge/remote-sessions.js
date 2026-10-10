const crypto = require('node:crypto');

const TTL = 8 * 60 * 60 * 1000;
function fail(code, status = 401) { return Object.assign(new Error(code), { status }); }
function createRemoteSessions(deps) {
  const sessions = new Map(), starts = new Map(), jobs = new Map();
  const now = deps.now || Date.now;
  let active = 0;
  function sweep() {
    for (const [id, session] of sessions) if (session.deadline <= now()) { session.controllers.forEach(controller => controller.abort()); sessions.delete(id); }
    for (const [client, value] of starts) if (value.until <= now()) starts.delete(client);
    for (const [id, job] of jobs) if (job.deadline <= now() || !sessions.has(job.owner)) { job.controller.abort(); jobs.delete(id); }
  }
  function create(client) {
    sweep();
    const counter = starts.get(client) || { count: 0, until: now() + 60000 };
    if (counter.count >= 5 || sessions.size >= 128) throw fail('login_rate_limited', 429);
    counter.count++; starts.set(client, counter);
    const id = crypto.randomBytes(32).toString('base64url');
    sessions.set(id, { deadline: now() + TTL, credentials: null, device: null, generation: 0, pendingPoll: null, pendingRefresh: null, active: 0, controllers: new Set() });
    return id;
  }
  function get(id) {
    sweep();
    const session = sessions.get(id);
    if (!session) throw fail('authentication_required');
    return session;
  }
  function authenticated(session) { return Boolean(session.credentials?.accessToken && session.credentials.expiresAt > now()); }
  function view(session) {
    const device = session.device;
    return { bridge: 'gpt-node-studio-bridge', mode: 'server', sessionPresent: true, canRun: Boolean(session.credentials?.accessToken), authenticated: authenticated(session), status: device?.status || 'idle', userCode: device?.userCode || null, verificationUrl: device ? 'https://auth.openai.com/codex/device' : null, expiresIn: device ? Math.max(0, Math.floor((device.deadline - now()) / 1000)) : 0 };
  }
  function status(id) {
    if (!id) return { bridge: 'gpt-node-studio-bridge', mode: 'server', sessionPresent: false, canRun: false, authenticated: false, status: 'idle' };
    try { return view(get(id)); } catch { return { bridge: 'gpt-node-studio-bridge', mode: 'server', sessionPresent: false, canRun: false, authenticated: false, status: 'idle' }; }
  }
  async function startLogin(id) {
    const session = get(id);
    if (session.device?.status === 'pending' && session.device.deadline > now()) return view(session);
    if (session.starting || (session.lastStart && now() - session.lastStart < 30000)) throw fail('login_rate_limited', 429);
    const generation = ++session.generation;
    session.controllers.forEach(controller => controller.abort());
    session.credentials = null; session.lastStart = now(); session.starting = true;
    try {
      const auth = await deps.startDeviceAuthorization();
      if (get(id) !== session || session.generation !== generation) throw fail('login_cancelled', 409);
      session.device = { ...auth, status: 'pending', deadline: now() + auth.expiresIn * 1000, nextPoll: now() + auth.intervalMs };
      return view(session);
    } finally { session.starting = false; }
  }
  async function pollLogin(id) {
    const session = get(id), device = session.device, generation = session.generation;
    if (!device || device.status !== 'pending') return view(session);
    if (device.deadline <= now()) { device.status = 'expired'; return view(session); }
    if (session.pendingPoll) return session.pendingPoll;
    if (device.nextPoll > now()) return view(session);
    device.nextPoll = now() + device.intervalMs;
    session.pendingPoll = (async () => {
      try {
        const result = await deps.pollDeviceAuthorization(device.deviceAuthId, device.userCode);
        if (get(id) !== session || session.generation !== generation || session.device !== device) throw fail('login_cancelled', 409);
        if (device.deadline <= now()) { device.status = 'expired'; return view(session); }
        if (!result.pending) {
          if (!result.session?.accessToken || result.session.expiresAt <= now()) throw fail('authentication_required');
          session.credentials = result.session; device.status = 'authenticated';
        }
        return view(session);
      } catch (error) {
        if (session.generation === generation) device.status = 'error';
        throw error;
      } finally { session.pendingPoll = null; }
    })();
    return session.pendingPoll;
  }
  async function credentials(id, session) {
    if (authenticated(session)) return session.credentials;
    const previous = session.credentials, generation = session.generation;
    if (!previous?.refreshToken) throw fail('authentication_required');
    if (!session.pendingRefresh) session.pendingRefresh = (async () => {
      try {
        const result = await deps.refreshSession(previous);
        if (get(id) !== session || session.generation !== generation || session.credentials !== previous) throw fail('authentication_required');
        session.credentials = result;
        if (!authenticated(session)) throw fail('authentication_required');
        return result;
      } catch { if (session.credentials === previous) session.credentials = null; throw fail('authentication_required'); }
      finally { session.pendingRefresh = null; }
    })();
    return session.pendingRefresh;
  }
  function logout(id) {
    const session = get(id);
    session.generation++; session.credentials = null; session.device = null;
    session.controllers.forEach(controller => controller.abort());
    sessions.delete(id);
    return { ok: true, authenticated: false };
  }
  async function run(id, action, input, signal) {
    const session = get(id);
    if (session.active >= 2 || active >= 4) throw fail('server_busy', 429);
    session.active++; active++;
    const controller = new AbortController(); session.controllers.add(controller);
    try {
      const credential = await credentials(id, session);
      const joined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      joined.throwIfAborted();
      if (action === 'plan') { const result = await deps.planWithSession(input.prompt, credential, joined); joined.throwIfAborted(); return result; }
      if (!['generate', 'edit'].includes(action)) throw fail('invalid_operation', 400);
      const result = await deps.executeWithSession(action, input, credential, joined);
      joined.throwIfAborted();
      return { imageUrl: result.imageUrl };
    } finally { session.controllers.delete(controller); session.active--; active--; }
  }
  function submitImage(id, action, input) {
    const session = get(id);
    if (!session.credentials?.accessToken) throw fail('authentication_required');
    if (session.active >= 2 || active >= 4) throw fail('server_busy', 429);
    if (jobs.size >= 32) {
      const consumed = [...jobs].find(([, job]) => job.observed && job.status !== 'running');
      if (!consumed) throw fail('server_busy', 429);
      jobs.delete(consumed[0]);
    }
    const jobId = crypto.randomBytes(24).toString('base64url');
    const job = { owner: id, status: 'running', deadline: now() + 5 * 60000, controller: new AbortController() };
    jobs.set(jobId, job);
    run(id, action, input, job.controller.signal).then(result => { job.result = result; job.status = 'done'; }, error => { job.status = 'error'; job.error = { error: job.controller.signal.aborted ? 'job_cancelled' : error.message, status: job.controller.signal.aborted ? 409 : error.status || 502, providerStatus: error.providerStatus, providerCode: error.providerCode }; });
    return { jobId, status: 'running' };
  }
  function imageJob(id, jobId, cancel = false) {
    get(id);
    const job = jobs.get(jobId);
    if (!job || job.owner !== id) throw fail('job_not_found', 404);
    if (cancel) { job.controller.abort(); jobs.delete(jobId); return { cancelled: true }; }
    if (job.status !== 'running') job.observed = true;
    if (job.status === 'error') throw Object.assign(fail(job.error.error, job.error.status), { providerStatus: job.error.providerStatus, providerCode: job.error.providerCode });
    return job.status === 'done' ? { status: 'done', ...job.result } : { status: 'running' };
  }
  return { create, status, startLogin, pollLogin, logout, run, submitImage, imageJob };
}
module.exports = { createRemoteSessions };
