const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../web/node_modules/typescript');
require('./load-ts.cjs');
const { estimateRequests } = require('../web/app/workflow-engine.ts');
const { parseProjectBackup } = require('../web/app/project-backup.ts');
const { planningSources, planningPrompt, materializePlan } = require('../web/app/workflow-plan.ts');
const backup = () => ({ format: 'gpt-node-studio', version: 1, projectName: 'Test', request: '', imageUrl: '', imageName: '', history: [], nodes: [{ id: 1, type: 'image', x: 0, y: 0, imageUrl: 'data:image/png;base64,YQ==' }], edges: [] });
test('portable backup restores graph and embedded image', () => {
  // Given
  const saved = JSON.stringify(backup());
  // When
  const result = parseProjectBackup(JSON.parse(saved));
  // Then
  assert.equal(result.nodes[0].imageUrl, backup().nodes[0].imageUrl);
  assert.equal(result.projectName, 'Test');
});
test('backup rejects external URLs, unknown node types and invalid edges', () => {
  // Given
  const cases = [backup(), backup(), backup()];
  cases[0].nodes[0].imageUrl = 'https://evil.example/pixel';
  cases[1].nodes[0].type = 'unknown';
  cases[2].edges = [{ id: 1, source: 1, target: 999 }];
  // When / Then
  for (const value of cases) assert.throws(() => parseProjectBackup(value));
});
test('request estimate accounts for operations and bounded repeat passes', () => {
  // Given
  const nodes = [{ id: 1, type: 'generate' }, { id: 2, type: 'repeat', prompt: 'REPEAT:99' }, { id: 3, type: 'preview' }];
  // When
  const count = estimateRequests(nodes);
  // Then
  assert.equal(count, 6);
});
function planner(initialNodes = []) {
  const source = fs.readFileSync(require.resolve('../web/app/page.tsx'), 'utf8');
  const code = source.slice(source.indexOf('  const plan = async'), source.indexOf('  const applyPreset'));
  let finish; let calls = 0; let applied = 0; let appliedNodes;
  const context = { nodes: initialNodes, edges: [], uploading: false, toolScope: initialNodes, toolScopeName: '전체 작업', scopeStyle: undefined, batchInput: initialNodes.find(node => node.images), planningSources, planningPrompt, materializePlan, crypto: require('node:crypto').webcrypto, AbortController, AbortSignal, request: 'cat', executionRef: { current: null }, planningRef: { current: null }, nodeCatalog: { prompt: {}, generate: {}, preview: {} }, setPlanning() {}, setMessage() {}, setRunState() {}, setRunLabel() {}, setRunProgress() {}, insertToolFlow(built) { applied++; appliedNodes = built.nodes; }, localBridgeFetch: () => { calls++; return new Promise(resolve => { finish = (plannedNodes) => resolve({ ok: true, json: async () => ({ mode: 'gpt', nodes: (plannedNodes || [{ id: 1, type: 'generate' }]).map((node,index) => ({...node,x:70+index*290,y:140})), edges: [], review: {summary:'구성 완료',warnings:[]} }) }); }); } };
  vm.createContext(context); vm.runInContext(ts.transpile(code + '\nglobalThis.plan = plan;', { target: ts.ScriptTarget.ES2022 }), context);
  return { context, finish: (nodes) => finish(nodes), appliedNodes: () => appliedNodes, calls: () => calls, applied: () => applied };
}
test('overlapping planning submits a single request', async () => {
  // Given
  const p = planner(); const pending = p.context.plan();
  // When
  await p.context.plan(); p.finish(); await pending;
  // Then
  assert.equal(p.calls(), 1); assert.equal(p.applied(), 1);
});
test('cancelled planning cannot apply a late response', async () => {
  // Given
  const p = planner(); const pending = p.context.plan();
  // When
  p.context.planningRef.current.abort(); p.finish(); await pending;
  // Then
  assert.equal(p.applied(), 0); assert.equal(p.context.planningRef.current, null);
});
test('compatible GPT replanning preserves the uploaded batch and selected result mode', async () => {
  const images = [{id:'A',name:'A.png',url:'data:image/png;base64,YQ=='},{id:'B',name:'B.png',url:'data:image/png;base64,Yg=='}];
  const original = [{id:9,type:'image',x:0,y:0,imageUrl:images[0].url,imageName:'2 photos',images,batchOutput:'sheet'}];
  const p = planner(original);
  p.context.nodeCatalog.image = {}; const pending=p.context.plan();p.finish([{id:1,type:'image'}]);await pending;
  assert.equal(p.applied(),1);assert.deepEqual(p.appliedNodes()[0].images,images);assert.equal(p.appliedNodes()[0].batchOutput,'sheet');assert.equal(p.appliedNodes()[0].imageUrl,images[0].url);assert.deepEqual(p.context.nodes,original);assert.notEqual(p.appliedNodes()[0].id,9);
});
test('project image save removes obsolete records without touching other projects', async () => {
  // Given: an in-memory IndexedDB cursor seam; the real save function owns retention.
  const records = new Map([['project:A:history:old', 'old'], ['project:A:node:1', 'old-node'], ['project:B:node:1', 'other']]);
  const db = { close() {}, transaction() {
    const transaction = { objectStore: () => ({
      put: (value, key) => records.set(key, value),
      openCursor: (range) => {
        const cursor = {};
        const keys = [...records.keys()].filter(key => key >= range.lower && key <= range.upper);
        let position = 0;
        const advance = () => queueMicrotask(() => {
          const key = keys[position++];
          cursor.result = key ? { key, delete: () => records.delete(key), continue: advance } : null;
          cursor.onsuccess();
          if (!key) transaction.oncomplete();
        });
        advance(); return cursor;
      },
    }) }; return transaction;
  } };
  const previousDb = global.indexedDB, previousRange = global.IDBKeyRange;
  global.indexedDB = { open() { const request = { result: db }; queueMicrotask(() => request.onsuccess()); return request; } };
  global.IDBKeyRange = { bound: (lower, upper) => ({ lower, upper }) };
  try {
    // When
    await require('../web/app/image-store.ts').saveImageRecords([{ key: 'node:1', url: 'new-node' }], 'A');
    // Then
    assert.deepEqual([...records], [['project:A:node:1', 'new-node'], ['project:B:node:1', 'other']]);
  } finally { global.indexedDB = previousDb; global.IDBKeyRange = previousRange; }
});
