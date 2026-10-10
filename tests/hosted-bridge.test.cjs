const { test, after } = require('node:test');
const assert = require('node:assert/strict');
require('./load-ts.cjs');
const { hostedBridge } = require('../web/app/api/hosted-bridge.ts');
const originalFetch = global.fetch;
const originalMode = process.env.FRAMEFLOW_SERVER_MODE, originalKey = process.env.FRAMEFLOW_SERVER_BRIDGE_KEY, originalOrigin = process.env.FRAMEFLOW_PUBLIC_ORIGIN;
process.env.FRAMEFLOW_SERVER_MODE = '1'; process.env.FRAMEFLOW_SERVER_BRIDGE_KEY = 'k'.repeat(43); process.env.FRAMEFLOW_PUBLIC_ORIGIN = 'https://test.example';
after(() => { global.fetch = originalFetch; for (const [key, value] of Object.entries({ FRAMEFLOW_SERVER_MODE: originalMode, FRAMEFLOW_SERVER_BRIDGE_KEY: originalKey, FRAMEFLOW_PUBLIC_ORIGIN: originalOrigin })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
function request(path, method = 'GET', headers = {}, body) { return new Request(`https://test.example${path}`, { method, headers: { host: 'test.example', origin: 'https://test.example', ...headers }, body }); }
test('server creates an opaque secure cookie and exposes no credentials', async () => {
  const calls = [];
  global.fetch = async (url, options) => { calls.push(url); assert.equal(options.headers['X-Frameflow-Server-Key'], 'k'.repeat(43)); return Response.json(url.endsWith('/new') ? { id: 'a'.repeat(43) } : { userCode: 'test-code', authenticated: false }); };
  const response = await hostedBridge(request('/login', 'POST'), { path: '/remote/auth/device/start', method: 'POST', create: true });
  assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=28800; Secure/);
  assert.equal(JSON.stringify(await response.json()).includes('kkkk'), false);
  assert.equal(calls.length, 2);
});
test('missing session and foreign origin cannot call a provider or host account', async () => {
  global.fetch = async () => { throw Error('must not call bridge'); };
  const options = { path: '/remote/v1/plan', method: 'POST', operation: 'plan' };
  assert.equal((await hostedBridge(request('/plan', 'POST', {}, '{}'), options)).status, 401);
  assert.equal((await hostedBridge(request('/plan', 'POST', { origin: 'https://evil.example' }, '{}'), options)).status, 403);
});
test('operation forwards only the matching session and logout clears its cookie', async () => {
  const id = 'b'.repeat(43), calls = [];
  global.fetch = async (url, options) => { calls.push(url); assert.equal(options.headers['X-Frameflow-Session'], id); return Response.json(url.endsWith('/status') ? { canRun: true } : { imageUrl: 'test-result' }); };
  const cookie = { cookie: `frameflow_server_session=${id}` };
  const response = await hostedBridge(request('/execute', 'POST', cookie, JSON.stringify({ kind: 'edit', prompt: 'cutout' })), { path: '/remote/v1/generate', method: 'POST', operation: 'image' });
  assert.equal(response.status, 200); assert.match(calls[1], /remote\/v1\/edit$/);
  const logout = await hostedBridge(request('/logout', 'POST', cookie), { path: '/remote/auth/logout', method: 'POST', logout: true });
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});
test('upstream 502 is returned as JSON dependency failure and moderation rejection is explicit', async () => {
  const cookie = { cookie: `frameflow_server_session=${'c'.repeat(43)}` };
  const options = { path: '/remote/jobs', method: 'GET', job: 'j'.repeat(32) };
  global.fetch = async () => Response.json({ error: 'provider_request_failed' }, { status: 502 });
  const failed = await hostedBridge(request('/job', 'GET', cookie), options);
  assert.equal(failed.status, 424); assert.equal((await failed.json()).error, 'provider_request_failed');
  global.fetch = async () => Response.json({ error: 'provider_request_failed', providerStatus: 400, providerCode: 'moderation_blocked' }, { status: 502 });
  const blocked = await hostedBridge(request('/job', 'GET', cookie), options);
  assert.equal(blocked.status, 422); const data = await blocked.json();
  assert.equal(data.error, 'provider_moderation_blocked'); assert.match(data.message, /안전 정책/);
});
test('invalid GPT plan is reconstructed once with the same visitor session and original context', async () => {
  const id='d'.repeat(43), cookie={cookie:`frameflow_server_session=${id}`}, plans=[];
  const prompt=JSON.stringify({request:'누끼 뒤 조명 추가',context:{workflow:{nodes:[{id:1,type:'image',inputMode:'each',imageIndices:[0,1]}]},images:[{index:0,name:'제품1'},{index:1,name:'제품2'}]}});
  global.fetch=async (url,options)=>{
    assert.equal(options.headers['X-Frameflow-Session'],id);
    if(url.endsWith('/status')) return Response.json({canRun:true});
    plans.push(JSON.parse(options.body));
    return plans.length===1 ? Response.json({error:'provider_plan_invalid'},{status:502}) : Response.json({mode:'gpt',nodes:[{id:1}],edges:[],review:{summary:'검증됨'}});
  };
  const result=await hostedBridge(request('/plan','POST',cookie,JSON.stringify({prompt})),{path:'/remote/v1/plan',method:'POST',operation:'plan'});
  assert.equal(result.status,200);assert.equal(plans.length,2);
  const retry=JSON.parse(plans[1].prompt);
  assert.deepEqual(retry.context,JSON.parse(prompt).context);assert.equal(retry.request,JSON.parse(prompt).request);
  assert.deepEqual(retry.repair,{attempt:1,validationCode:'structure'});assert.ok(plans[1].prompt.length<=8000);
});
test('plan reconstruction is bounded and gives an actionable error without retrying image generation',async()=>{
  const cookie={cookie:`frameflow_server_session=${'e'.repeat(43)}`};let calls=0;
  global.fetch=async url=>url.endsWith('/status')?Response.json({canRun:true}):(calls++,Response.json({error:'provider_plan_invalid'},{status:502}));
  const result=await hostedBridge(request('/plan','POST',cookie,JSON.stringify({prompt:'누끼'})),{path:'/remote/v1/plan',method:'POST',operation:'plan'});
  assert.equal(calls,2);assert.equal(result.status,424);assert.match((await result.json()).message,/플로우.*검증/);
  calls=0;
  await hostedBridge(request('/image','POST',cookie,JSON.stringify({kind:'edit',prompt:'누끼'})),{path:'/remote/v1/edit',method:'POST',operation:'image'});
  assert.equal(calls,1);
  calls=0;
  await hostedBridge(request('/plan','POST',cookie,JSON.stringify({prompt:'x'.repeat(8000)})),{path:'/remote/v1/plan',method:'POST',operation:'plan'});
  assert.equal(calls,1);
});
test('cancelled planning and provider refusal do not start reconstruction',async()=>{
  const cookie={cookie:`frameflow_server_session=${'f'.repeat(43)}`},options={path:'/remote/v1/plan',method:'POST',operation:'plan'};
  let calls=0;const controller=new AbortController();
  global.fetch=async url=>{
    if(url.endsWith('/status')) return Response.json({canRun:true});
    calls++;controller.abort();return Response.json({error:'provider_plan_invalid'},{status:502});
  };
  const cancelled=new Request(request('/plan','POST',cookie,JSON.stringify({prompt:'조명 추가'})),{signal:controller.signal});
  await hostedBridge(cancelled,options);assert.equal(calls,1);
  calls=0;
  global.fetch=async url=>url.endsWith('/status')?Response.json({canRun:true}):(calls++,Response.json({error:'provider_plan_refused'},{status:502}));
  const refused=await hostedBridge(request('/plan','POST',cookie,JSON.stringify({prompt:'조명 추가'})),options);
  assert.equal(calls,1);assert.match((await refused.json()).message,/거절/);
});
test('GPT planning timeout returns a planning error instead of a connection warning', async()=>{
  const cookie={cookie:`frameflow_server_session=${'g'.repeat(43)}`};let plans=0;
  global.fetch=async url=>{
    if(url.endsWith('/status'))return Response.json({canRun:true});
    plans++;throw new DOMException('The operation was aborted due to timeout','TimeoutError');
  };
  const result=await hostedBridge(request('/plan','POST',cookie,JSON.stringify({prompt:'남자와 여자 모델로 룩북 4장'})),{path:'/remote/v1/plan',method:'POST',operation:'plan'});
  assert.equal(result.status,424);const data=await result.json();
  assert.equal(data.error,'provider_plan_timeout');assert.match(data.message,/구성.*시간/);assert.doesNotMatch(data.message,/연결 상태/);assert.equal(plans,1);
});
