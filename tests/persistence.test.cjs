const test = require('node:test');
const assert = require('node:assert/strict');
const { persistenceHarness } = require('./persistence-harness.cjs');
const snapshot = (id, prompt = 'saved') => ({ projectId: id, imageStorageVersion: 2, projectName: id, nodes: [{ id: 1, type: 'prompt', x: 0, y: 0, prompt }], groups: [], edges: [], history: [] });
function seed(f, id, latest = false) { const value = JSON.stringify(snapshot(id)); f.metadata.set(`gpt-node-studio-project-${id}`, value); if (latest) f.metadata.set('gpt-node-studio-workflow-v2', value); }
async function ready() { const f = persistenceHarness(); seed(f, 'A', true); seed(f, 'B'); f.render(); await f.settle(); return f; }

test('failed hydration preserves saved default project and pixels until explicit new project recovery', async () => {
  // Given
  const f = persistenceHarness(); seed(f, 'default', true); f.pixels.set('default', { orphan: 'original-pixels' }); const original = f.metadata.get('gpt-node-studio-workflow-v2'); f.failRead();
  // When
  f.render(); await f.settle(); await f.timers(); await f.api.saveProject();
  // Then
  assert.equal(f.metadata.get('gpt-node-studio-workflow-v2'), original); assert.equal(f.pixels.get('default').orphan, 'original-pixels'); assert.equal(f.api.hydrated, false);
});
test('explicit new project recovers failed hydration without overwriting the failed project', async () => {
  // Given
  const f = persistenceHarness(); seed(f, 'default', true); f.failRead(); f.render(); await f.settle(); const original = f.metadata.get('gpt-node-studio-project-default');
  // When
  await f.api.createProject(); f.render(); await f.timers();
  // Then
  assert.equal(f.api.hydrated, true); assert.notEqual(f.api.currentProjectId, 'default'); assert.equal(f.metadata.get('gpt-node-studio-project-default'), original);
});
for (const action of ['open', 'create']) test(`${action} project flushes an edit before the 250ms timer fires`, async () => {
  // Given
  const f = await ready(); f.api.setNodes(nodes => nodes.map(node => ({ ...node, prompt: 'latest edit' }))); f.render();
  // When
  if (action === 'open') await f.api.openProject({ id: 'B', name: 'B' }); else await f.api.createProject(); f.render(); await f.timers();
  // Then
  assert.equal(JSON.parse(f.metadata.get('gpt-node-studio-project-A')).nodes[0].prompt, 'latest edit'); assert.notEqual(f.api.currentProjectId, 'A');
});
test('project transition saves matching image records and metadata for the latest input', async () => {
  // Given
  const f = await ready(); f.api.setNodes([{ id: 8, type: 'image', x: 0, y: 0, imageUrl: 'data:image/png;base64,YQ==' }]); f.render();
  // When
  await f.api.openProject({ id: 'B', name: 'B' }); f.render(); await f.timers();
  // Then
  assert.equal(JSON.parse(f.metadata.get('gpt-node-studio-project-A')).nodes[0].id, 8); assert.equal(f.pixels.get('A')['node:8'], 'data:image/png;base64,YQ=='); assert.equal(f.pixels.get('B')['node:8'], undefined);
});
test('backup import flushes the project it replaces', async () => {
  // Given
  const f = await ready(); f.api.setNodes(nodes => nodes.map(node => ({ ...node, prompt: 'before import' }))); f.render();
  const content = JSON.stringify({ ...snapshot('imported'), format: 'gpt-node-studio', version: 1, request: '', imageUrl: '', imageName: '' });
  // When
  await f.api.importProject({ size: content.length, content }); f.render(); await f.timers();
  // Then
  assert.equal(JSON.parse(f.metadata.get('gpt-node-studio-project-A')).nodes[0].prompt, 'before import'); assert.notEqual(f.api.currentProjectId, 'A');
});
test('overlapping project opens cannot let a slow first read overwrite the accepted transition', async () => {
  // Given
  const f = await ready(); seed(f, 'C'); const release = f.holdRead();
  // When
  const first = f.api.openProject({ id: 'B', name: 'B' }); await new Promise(resolve => setImmediate(resolve)); const second = f.api.openProject({ id: 'C', name: 'C' }); release(); await Promise.all([first, second]); f.render();
  // Then
  assert.equal(f.api.currentProjectId, 'B');
});
test('failed pending save keeps the current project open and reports the error', async () => {
  // Given
  const f = await ready(); f.api.setNodes(nodes => nodes.map(node => ({ ...node, prompt: 'latest edit' }))); f.render(); f.failSave(true);
  // When
  await f.api.openProject({ id: 'B', name: 'B' }); f.render();
  // Then
  assert.equal(f.api.currentProjectId, 'A'); assert.match(f.api.message, /저장|전환/);
});
for (const id of ['A', 'B']) test(`deleting ${id === 'A' ? 'active' : 'inactive'} project removes orphan pixels and preserves other projects`, async () => {
  // Given
  const f = await ready(); await f.timers(); f.pixels.set(id, { orphan: 'old-image', 'history:lost': 'old-result' }); const other = id === 'A' ? 'B' : 'A'; f.pixels.set(other, { other: 'keep' });
  // When
  await f.api.deleteProject({ id, name: id }); f.render(); await f.timers();
  // Then
  assert.equal(f.pixels.has(id), false); assert.equal(f.metadata.has(`gpt-node-studio-project-${id}`), false); assert.equal(f.pixels.get(other).other, 'keep');
});
test('failed image namespace deletion preserves project metadata and reports failure', async () => {
  // Given
  const f = await ready(); f.failDelete(); const before = f.metadata.get('gpt-node-studio-project-B');
  // When
  await f.api.deleteProject({ id: 'B', name: 'B' }); f.render();
  // Then
  assert.equal(f.metadata.get('gpt-node-studio-project-B'), before); assert.match(f.api.message, /못했어요/); assert.doesNotMatch(f.api.message, /삭제했어요/);
});
test('a cyclic unselected canvas can render and remain editable instead of throwing in derived scopes', async () => {
  // Given
  const f = await ready();
  // When
  f.api.setNodes([{id:1,type:'image',x:0,y:0,images:[]},{id:2,type:'edit',x:1,y:1}]); f.api.setEdges([{id:1,source:1,target:2},{id:2,source:2,target:1}]);
  // Then
  assert.doesNotThrow(() => f.render()); assert.equal(f.api.nodes.length, 2);
});

test('IndexedDB project deletion removes its entire encoded namespace and preserves neighboring and legacy keys', async () => {
  // Given
  const { deleteProjectImageRecords } = require('../web/app/image-store.ts');
  const records = new Map([['project:A%3AB:orphan','old'],['project:A%3AB:history:missing','result'],['project:A%3ABB:node:1','other'],['project:Z:node:1','other'],['node:1','legacy']]);
  let closed = false;
  const db = { close() { closed = true; }, transaction() { const transaction = { objectStore: () => ({ delete(range) { for (const key of records.keys()) if (key >= range.lower && key <= range.upper) records.delete(key); queueMicrotask(() => transaction.oncomplete()); } }) }; return transaction; } };
  const previousDb = global.indexedDB, previousRange = global.IDBKeyRange;
  global.indexedDB = { open() { const request = { result: db }; queueMicrotask(() => request.onsuccess()); return request; } };
  global.IDBKeyRange = { bound: (lower, upper) => ({ lower, upper }) };
  try {
    // When
    await deleteProjectImageRecords('A:B');
    // Then
    assert.deepEqual([...records.keys()], ['project:A%3ABB:node:1','project:Z:node:1','node:1']); assert.equal(closed, true);
  } finally { global.indexedDB = previousDb; global.IDBKeyRange = previousRange; }
});
