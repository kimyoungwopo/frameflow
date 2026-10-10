const { config, configured, refreshSession } = require('./oauth');
const { readSession, saveSession, validSession } = require('./session-store');
const { normalizeProviderImage, readProviderJson } = require('./provider-image');
let refreshInFlight = null;
async function authenticatedSession() {
  const session = readSession();
  if (validSession(session)) return session;
  if (!session?.refreshToken) throw Object.assign(new Error('authentication_required'), { status: 401 });
  if (!refreshInFlight) refreshInFlight = refreshSession(session).then(updated => {
    const current = readSession();
    if (!current || current.accessToken !== session.accessToken || current.refreshToken !== session.refreshToken) throw Object.assign(new Error('authentication_required'), { status: 401 });
    saveSession(updated); return updated;
  }).catch(() => { throw Object.assign(new Error('authentication_required'), { status: 401 }); }).finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function execute(kind, payload, signal) {
  if (!configured()) { const error = new Error('provider_not_configured'); error.status = 501; throw error; }
  const session = await authenticatedSession();
  return executeWithSession(kind, payload, session, signal);
}
async function executeWithSession(kind, payload, session, signal) {
  if (!validSession(session)) throw Object.assign(new Error('authentication_required'), { status: 401 });
  const endpoint = kind === 'edit' ? config.editUrl : config.generateUrl;
  const headers = { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (session.accountId) headers['chatgpt-account-id'] = session.accountId;
  const requestPayload = {
    model: payload.model || 'gpt-image-2',
    prompt: typeof payload.prompt === 'string' ? payload.prompt : '',
    ...(payload.background === 'transparent' || payload.background === 'white' || payload.background === 'black' ? { background: payload.background } : {})
  };
  if (kind === 'edit') {
    const images = Array.isArray(payload.imageUrls) && payload.imageUrls.length ? payload.imageUrls : (typeof payload.imageUrl === 'string' && payload.imageUrl ? [payload.imageUrl] : []);
    if (images.length) requestPayload.images = images.map((image_url) => ({ image_url }));
  }
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(240000)]) : AbortSignal.timeout(240000);
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(requestPayload), redirect: 'error', signal: requestSignal });
  const body = await readProviderJson(response);
  if (!response.ok) {
    const providerError = body?.error;
    const safeProviderCode = typeof providerError?.code === 'string' ? providerError.code.slice(0, 80) : null;
    const safeProviderParam = typeof providerError?.param === 'string' ? providerError.param.slice(0, 80) : null;
    console.warn('[provider] request failed', { kind, status: response.status, code: safeProviderCode, param: safeProviderParam });
    const error = new Error(response.status === 401 ? 'authentication_required' : 'provider_request_failed');
    error.status = response.status === 401 ? 401 : 502;
    error.providerStatus = response.status;
    error.providerCode = safeProviderCode;
    error.providerParam = safeProviderParam;
    throw error;
  }
  const item = Array.isArray(body?.data) ? body.data[0] : body;
  const imageUrl = await normalizeProviderImage(item, endpoint, requestSignal);
  return { ...body, imageUrl };
}
async function planWorkflow(prompt, signal) {
  const session = config.planAuth === 'api-key' ? null : await authenticatedSession();
  const token = config.planAuth === 'api-key' ? process.env.OPENAI_API_KEY : session.accessToken;
  return planRequest(prompt, token, session?.accountId, signal);
}
async function planWithSession(prompt, session, signal) {
  console.info('[planner] request started', { promptLength: prompt.length });
  if (!validSession(session)) throw Object.assign(new Error('authentication_required'), { status: 401 });
  return planRequest(prompt, session.accessToken, session.accountId, signal);
}
async function planRequest(prompt, token, accountId, signal) {
  const { schema, requestInstructions, validatePlan } = require('./planner-contract');
  const { readResponse } = require('./responses-reader');
  if (!token) throw Object.assign(new Error('workflow_plan_not_configured'), { status: 501 });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (accountId) headers['chatgpt-account-id'] = accountId;
  if (config.planAuth === 'codex') headers.originator = 'codex_cli_rs';
  const body = { model: config.planModel, instructions: requestInstructions(prompt), input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }], store: false, stream: true, reasoning: { effort: 'low' }, text: { format: { type: 'json_schema', name: 'image_workflow', strict: true, schema } } };
  const response = await fetch(config.planUrl, { method: 'POST', headers, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
  console.info('[planner] response received', { status: response.status });
  if (!response.ok) {
    await response.body?.cancel();
    const error = new Error(response.status === 401 ? 'authentication_required' : response.status === 429 ? 'provider_plan_rate_limited' : response.status === 403 ? 'provider_plan_forbidden' : 'provider_plan_failed');
    error.status = [401, 403, 429].includes(response.status) ? response.status : 502;
    throw error;
  }
  let result;
  try {
    const planned = await readResponse(response);
    let requestedTask = '';
    try { const envelope = JSON.parse(prompt); requestedTask = envelope && typeof envelope.request === 'string' ? envelope.request : ''; } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    result = validatePlan(planned, { request: requestedTask });
  }
  catch (error) {
    if (error.message === 'provider_plan_invalid') console.warn('[planner] validation failed', { reason: error.planReason || 'response_format', node: error.planNode ?? null });
    throw error;
  }
  return { ...result, mode: 'gpt', model: config.planModel };
}
module.exports = { execute, planWorkflow, executeWithSession, planWithSession };
