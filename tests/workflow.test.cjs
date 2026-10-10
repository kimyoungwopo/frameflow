const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../web/node_modules/typescript');
require('./load-ts.cjs');
const engine = require('../web/app/workflow-engine.ts');
const { runBatch } = require('../web/app/batch-runner.ts');
const { sharedJobs } = require('../web/app/shared-flow.ts');
const { addResult, resultUnits } = require('../web/app/result-folders.ts');
const crypto = require('node:crypto').webcrypto;

async function run(nodes, edges, respond, options = {}) {
  const calls = [];
  const previews = new Map();
  const messages = [];
  const history = [...(options.history || [])];
  const source = fs.readFileSync(require.resolve('../web/app/page.tsx'), 'utf8');
  const runner = source.slice(source.indexOf('  const runWorkflow = async'), source.indexOf('  const startLogin = async () => {'));
  const context = {
    ...engine, crypto, runBatch, sharedJobs, composeSheet: async urls => `sheet:${urls.join('|')}`, encodeGif: async (frames, fps) => `gif:${fps}:${frames.join('|')}`, encodeApng: async (frames, fps) => `apng:${fps}:${frames.join('|')}`, splitMotionAtlas: async (atlas, count) => Array.from({ length: count }, (_, index) => `${atlas}-frame-${index + 1}`), selectedGroup: options.selectedGroup || null, groups: options.groups || [], setBatchTasks() {}, AbortController, AbortSignal, executionRef: { current: null }, planningRef: { current: null }, runningNodeIds: { current: new Set() },
    nodes, edges, selected: null, runState: 'idle', request: 'keep the subject',
    optimizeImageDataUrl: async (url) => url,
    reviewWorkflow: () => null,
    setNodes: (update) => {
      const updated = update(nodes);
      for (const node of updated) if (node.type === 'preview' && node.imageUrl) previews.set(node.id, node.imageUrl);
      nodes.splice(0, nodes.length, ...updated);
    },
    setMessage(message) { messages.push(message); }, setRunState() {}, setRunLabel() {}, setRunProgress() {}, setRunMetrics() {},
    setActiveNodeIds() {}, setImageUrl() {}, setImageName() {}, addHistory(url,name,options) { const next=addResult(history,{id:crypto.randomUUID(),url,name,createdAt:new Date().toISOString(),...options},60);history.splice(0,history.length,...next); }, startLogin: async () => {},
    window: { setTimeout: (callback) => { callback(); return 0; } },
    localBridgeFetch: async (_url, options) => {
      const payload = JSON.parse(options.body);
      calls.push(payload);
      const result = respond ? respond(calls.length) : { status: 200, imageUrl: `result-${calls.length}` };
      return { status: result.status, ok: result.status === 200, json: async () => result };
    },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpile(`${runner}\nglobalThis.run = runWorkflow;`, { target: ts.ScriptTarget.ES2022 }), context);
  await context.run(undefined, options.retryIds);
  return { calls, previews, nodes, history, messages };
}

const node = (id, type, extra = {}) => ({ id, type, title: type, ...extra });
const edge = (source, target) => ({ source, target });

test('manual edit uses its own instructions without a separate prompt node or project request', async () => {
  // Given
  const calls = [];
  const nodes = [node(1, 'image', { imageUrl: 'original' }), node(2, 'edit', { prompt: 'Keep the face and replace the background with a street' }), node(3, 'preview')];
  // When
  await engine.executeWorkflow({ nodes, edges: [edge(1, 2), edge(2, 3)], request: '', normalizeImage: async image => image, execute: async stage => { calls.push(stage); return 'edited'; } });
  // Then
  assert.equal(calls[0].prompt, nodes[1].prompt);
  assert.deepEqual(calls[0].imageUrls, ['original']);
});

test('local edit instructions supplement upstream instructions and are consumed by their stage', async () => {
  // Given
  const calls = [];
  const nodes = [node(1, 'image', { imageUrl: 'original' }), node(2, 'prompt', { prompt: 'Preserve the face' }), node(3, 'edit', { prompt: 'Replace the background' }), node(4, 'upscale'), node(5, 'preview')];
  // When
  await engine.executeWorkflow({ nodes, edges: [edge(1, 3), edge(2, 3), edge(3, 4), edge(4, 5)], request: 'General instruction', normalizeImage: async image => image, execute: async stage => { calls.push(stage); return 'edited'; } });
  // Then
  assert.equal(calls[0].prompt, 'Preserve the face. Replace the background');
  assert.ok(!calls[1].prompt.includes('Replace the background'));
});

test('manual cutout instructions request transparent image output', async () => {
  // Given
  const calls = [];
  const nodes = [node(1, 'image', { imageUrl: 'original' }), node(2, 'edit', { prompt: '/REMOVEBG Preserve the product' }), node(3, 'preview')];
  // When
  await engine.executeWorkflow({ nodes, edges: [edge(1, 2), edge(2, 3)], request: '', normalizeImage: async image => image, execute: async stage => { calls.push(stage); return 'cutout'; } });
  // Then
  assert.equal(calls[0].background, 'transparent');
});

test('display description alone does not silently become edit instructions', () => {
  // Given
  const nodes = [node(1, 'image', { imageUrl: 'original' }), node(2, 'edit', { taskDetail: 'A display description' }), node(3, 'preview')];
  // When / Then
  assert.throws(() => engine.validateWorkflow(nodes, [edge(1, 2), edge(2, 3)], ''), /PROMPT/);
});

test('manual edit instructions reach the actual workflow request payload', async () => {
  // Given
  const nodes = [node(1, 'image', { imageUrl: 'original' }), node(2, 'edit', { prompt: 'Keep the face and replace the street background' }), node(3, 'preview')];
  // When
  const result = await run(nodes, [edge(1, 2), edge(2, 3)]);
  // Then
  assert.equal(result.calls[0].prompt, nodes[1].prompt);
  assert.equal(result.previews.get(3), 'result-1');
});

test('product edit sends one request; prompt nodes only configure the edit', async () => {
  const result = await run([node(1, 'image', { imageUrl: 'original' }), node(2, 'prompt', { prompt: 'advertisement' }), node(3, 'edit'), node(4, 'preview')], [edge(1, 3), edge(2, 3), edge(3, 4)]);
  assert.equal(result.calls.length, 1);
});

test('branches edit the original independently and update their own previews', async () => {
  const result = await run([node(1, 'image', { imageUrl: 'original' }), node(2, 'edit'), node(3, 'preview'), node(4, 'edit'), node(5, 'preview')], [edge(1, 2), edge(2, 3), edge(1, 4), edge(4, 5)]);
  assert.deepEqual(Array.from(result.calls[1].imageUrls), ['original']);
  assert.equal(result.previews.get(3), 'result-1');
  assert.equal(result.previews.get(5), 'result-2');
});

test('authentication failure stops later stages immediately', async () => {
  const result = await run([node(1, 'prompt', { prompt: 'cat' }), node(2, 'generate'), node(3, 'upscale'), node(4, 'preview')], [edge(1, 2), edge(2, 3), edge(3, 4)], () => ({ status: 401, error: 'authentication_required' }));
  assert.equal(result.calls.length, 1);
  assert.equal(result.previews.size, 0);
});

test('group execution excludes unrelated images and retry targets only failed chains', async () => {
  const nodes = [node(1,'image',{imageUrl:'A',groupId:'g'}),node(2,'edit',{groupId:'g'}),node(3,'preview',{groupId:'g'}),node(4,'image',{imageUrl:'B',groupId:'other'}),node(5,'edit',{groupId:'other'}),node(6,'preview',{groupId:'other'})];
  const edges = [edge(1,2),edge(2,3),edge(4,5),edge(5,6)];
  const scoped = await run(nodes,edges,undefined,{selectedGroup:'g',groups:[{id:'g',name:'Cutout'}]});
  assert.equal(scoped.calls.length,1);assert.deepEqual(Array.from(scoped.calls[0].imageUrls),['A']);assert.equal(scoped.previews.has(6),false);
  const successfulPreview = nodes.find(node => node.id === 3);
  const retry = await run(nodes,edges,undefined,{retryIds:[4]});
  assert.equal(retry.calls.length,1);assert.deepEqual(Array.from(retry.calls[0].imageUrls),['B']);assert.equal(retry.nodes.find(node => node.id === 3),successfulPreview);assert.equal(retry.previews.get(3),successfulPreview.imageUrl);
});
test('partial photo failure keeps the other preview and avoids automatic retry', async () => {
  const result = await run([node(1,'image',{imageUrl:'A'}),node(2,'edit'),node(3,'preview'),node(4,'image',{imageUrl:'B'}),node(5,'edit'),node(6,'preview')],[edge(1,2),edge(2,3),edge(4,5),edge(5,6)],index=>index===1?{status:502,error:'provider_failed',message:'Photo failed'}:{status:200,imageUrl:'B-result'});
  assert.equal(result.calls.length,2);assert.equal(result.previews.has(3),false);assert.equal(result.previews.get(6),'B-result');
});

test('retry of a failed independent chain preserves the successful preview and history', async () => {
  // Given
  const edges = [edge(1,2),edge(2,3),edge(4,5),edge(5,6)];
  const first = await run([node(1,'image',{imageUrl:'A'}),node(2,'edit'),node(3,'preview'),node(4,'image',{imageUrl:'B'}),node(5,'edit'),node(6,'preview')], edges, index => index === 1 ? {status:502,error:'provider_failed'} : {status:200,imageUrl:'B-success'});
  const successful = first.nodes.find(node => node.id === 6), historyId = first.history[0].id;
  // When
  const retry = await run(first.nodes, edges, () => ({status:200,imageUrl:'A-retry'}), {retryIds:[1],history:first.history});
  // Then
  assert.equal(retry.calls.length, 1); assert.equal(retry.nodes.find(node => node.id === 6), successful); assert.equal(successful.imageUrl, 'B-success'); assert.equal(retry.history.find(image => image.url === 'B-success').id, historyId);
});
for (const options of [{ selectedGroup: 'good' }, { retryIds: [1] }]) test(`${options.retryIds ? 'retry' : 'group'} caller ignores an unrelated cyclic branch`, async () => {
  // Given
  const nodes = [node(1,'image',{imageUrl:'A',groupId:'good'}),node(2,'edit',{groupId:'good'}),node(3,'preview',{groupId:'good'}),node(4,'image',{imageUrl:'B'}),node(5,'edit')];
  const edges = [edge(1,2),edge(2,3),edge(4,5),edge(5,4)];
  // When
  const result = await run(nodes,edges,undefined,options);
  // Then
  assert.equal(result.calls.length,1); assert.equal(result.nodes.find(node => node.id === 3).imageUrl,'result-1');
});

test('motion requests one atlas, crops exact cells, and encodes the result', async () => {
  const calls = [];
  let encoded;
  await engine.executeWorkflow({
    nodes: [node(1, 'image', { imageUrl: 'original' }), node(2, 'prompt', { prompt: 'idle 모션' }), node(3, 'motion', { taskDetail: '4프레임 · 6FPS' }), node(4, 'preview')],
    edges: [edge(1, 2), edge(2, 3), edge(3, 4)],
    request: '', normalizeImage: async image => image,
    execute: async stage => { calls.push(stage); return 'atlas-1'; },
    splitMotionAtlas: async (atlas, count) => { assert.equal(atlas, 'atlas-1'); assert.equal(count, 4); return ['frame-1', 'frame-2', 'frame-3', 'frame-4']; },
    encodeAnimation: async (frames, fps) => { encoded = { frames, fps }; return 'gif-result'; },
  });
  assert.equal(calls.length, 1);
  assert.equal(encoded.fps, 6);
  assert.deepEqual(encoded.frames, ['frame-1', 'frame-2', 'frame-3', 'frame-4']);
  assert.ok(calls[0].prompt.includes('horizontal pixel-animation atlas'));
  assert.ok(calls[0].prompt.includes('exactly 4 equal-width frames'));
  assert.ok(calls[0].prompt.toLowerCase().includes('one motion only'));
});


test('shared flow stores one final result in source order despite two independent image requests', async () => {
  const graph=require('../web/app/studio-groups.ts').buildSharedCutout([{id:'A',name:'A',url:'original-A'},{id:'B',name:'B',url:'original-B'}],100,'g',150,'sheet');
  const result=await run(graph.nodes,graph.edges);
  assert.equal(result.calls.length,2);assert.deepEqual(result.calls.map(call=>Array.from(call.imageUrls)),[['original-A'],['original-B']]);
  assert.equal(result.history.length,1);assert.equal(result.history[0].url,'sheet:result-1|result-2');assert.equal(result.previews.size,1);assert.equal(result.previews.get(103),'sheet:result-1|result-2');
});
test('shared flow retries only the failed photo and assembles it with cached successful output', async () => {
  const graph=require('../web/app/studio-groups.ts').buildSharedCutout([{id:'A',name:'A',url:'original-A'},{id:'B',name:'B',url:'original-B'}],100,'g',150,'sheet');
  const first=await run(graph.nodes,graph.edges,index=>index===1?{status:502,error:'photo_failed'}:{status:200,imageUrl:'B-success'});
  assert.equal(first.history.length,0);assert.equal(first.nodes.find(node=>node.type==='preview').images.length,1);
  const retry=await run(first.nodes,graph.edges,()=>({status:200,imageUrl:'A-retry'}),{retryIds:['100:A']});
  assert.equal(retry.calls.length,1);assert.deepEqual(Array.from(retry.calls[0].imageUrls),['original-A']);assert.equal(retry.history[0].url,'sheet:A-retry|B-success');
});
test('changing a shared prompt blocks stale-cache retry before any provider request', async () => {
  const graph=require('../web/app/studio-groups.ts').buildSharedCutout([{id:'A',name:'A',url:'original-A'},{id:'B',name:'B',url:'original-B'}],100,'g',150,'sheet');
  const first=await run(graph.nodes,graph.edges,index=>index===1?{status:502,error:'photo_failed'}:{status:200,imageUrl:'B-success'});
  const command=first.nodes.find(node=>node.type==='command');command.prompt+=' changed';
  const retry=await run(first.nodes,graph.edges,undefined,{retryIds:['100:A']});assert.equal(retry.calls.length,0);assert.equal(retry.history.length,0);
});

test('default shared execution produces separate files in one folder and one preview collection', async () => {
  const graph=require('../web/app/studio-groups.ts').buildSharedCutout([{id:'A',name:'A.png',url:'original-A'},{id:'B',name:'B.png',url:'original-B'}],100,'g',150);
  const result=await run(graph.nodes,graph.edges);
  assert.equal(result.calls.length,2);assert.equal(result.history.length,2);assert.equal(resultUnits(result.history).length,1);
  const folder=resultUnits(result.history)[0];assert.equal(folder.folder.expectedCount,2);assert.deepEqual(folder.images.map(image=>image.url),['result-1','result-2']);
  const preview=result.nodes.find(node=>node.type==='preview');assert.equal(preview.previewMode,'each');assert.equal(preview.images.length,2);assert.equal(preview.resultFolder.id,folder.id);
  assert.ok(result.history.every(image=>!image.url.startsWith('sheet:')));
});
test('retry adds the failed photo into the existing result folder without losing the successful file', async () => {
  const graph=require('../web/app/studio-groups.ts').buildSharedCutout([{id:'A',name:'A.png',url:'original-A'},{id:'B',name:'B.png',url:'original-B'}],100,'g',150);
  const first=await run(graph.nodes,graph.edges,index=>index===1?{status:502,error:'photo_failed'}:{status:200,imageUrl:'B-success'});
  const folderId=first.history[0].folder.id, successfulId=first.history[0].id;
  const retry=await run(first.nodes,graph.edges,()=>({status:200,imageUrl:'A-retry'}),{retryIds:['100:A'],history:first.history});
  assert.equal(retry.calls.length,1);assert.equal(resultUnits(retry.history).length,1);assert.ok(retry.history.every(image=>image.folder.id===folderId));
  assert.equal(retry.history.find(image=>image.url==='B-success').id,successfulId);assert.deepEqual(resultUnits(retry.history)[0].images.map(image=>image.url),['A-retry','B-success']);
});
test('running the same input again creates a separate execution folder even when pixels match', async () => {
  const graph=require('../web/app/studio-groups.ts').buildSharedCutout([{id:'A',name:'A.png',url:'original-A'},{id:'B',name:'B.png',url:'original-B'}],100,'g',150);
  const first=await run(graph.nodes,graph.edges);const second=await run(first.nodes,graph.edges,undefined,{history:first.history});
  assert.equal(resultUnits(second.history).length,2);assert.equal(second.history.length,4);assert.notEqual(second.history[0].folder.id,first.history[0].folder.id);
});
