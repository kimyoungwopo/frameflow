const test = require('node:test');
const assert = require('node:assert/strict');
const { persistenceHarness } = require('./persistence-harness.cjs');

async function runningProject() {
  const opened = [];
  let created = 0;
  const navigation = { open: project => opened.push(project.id), create: () => created++, update() {}, isBusy: () => false, deleted() {} };
  const f = persistenceHarness({ navigation });
  f.metadata.set('gpt-node-studio-workflow-v2', JSON.stringify({ projectId: 'A', projectName: 'A', imageStorageVersion: 2, nodes: [], edges: [], groups: [], history: [] }));
  f.render(); await f.settle();
  f.api.setNodes([{ id: 1, type: 'prompt', x: 0, y: 0, prompt: 'Original instructions' }, { id: 2, type: 'generate', x: 200, y: 0 }, { id: 3, type: 'preview', x: 400, y: 0 }]);
  f.api.setEdges([{ id: 4, source: 1, target: 2 }, { id: 5, source: 2, target: 3 }]); f.render();
  let finish;
  const requests = [];
  f.setBridge((_path, options) => {
    requests.push(JSON.parse(options.body));
    return new Promise(resolve => { finish = () => resolve({ ok: true, status: 200, json: async () => ({ imageUrl: 'data:image/png;base64,YQ==' }) }); });
  });
  const pending = f.api.runWorkflow(); await f.settle();
  return { f, navigation, opened, created: () => created, requests, finish: () => finish(), pending };
}

test('new project navigation during execution preserves the original request and saves its results to its own project', async () => {
  // Given
  const r = await runningProject();
  const controller = r.f.api.executionRef.current;
  // When
  await r.f.api.createProject(); r.f.setProps({ active: false });
  const currentB = JSON.stringify({ projectId: 'B', nodes: [], history: [] });
  r.f.metadata.set('gpt-node-studio-workflow-v2', currentB);
  r.finish(); await r.pending; await r.f.settle(); await r.f.timers();
  // Then
  assert.equal(r.created(), 1); assert.equal(controller.signal.aborted, false);
  assert.equal(r.f.metadata.get('gpt-node-studio-workflow-v2'), currentB);
  const saved = JSON.parse(r.f.metadata.get('gpt-node-studio-project-A'));
  assert.equal(saved.history.length, 1); assert.equal(saved.history[0].projectId, 'A');
  assert.equal(r.f.pixels.get('A')['node:3'], 'data:image/png;base64,YQ==');
});

test('a new independent flow can be constructed while the original graph snapshot executes', async () => {
  // Given
  const r = await runningProject();
  // When
  r.f.api.startVisualTask('background'); r.f.render();
  r.finish(); await r.pending; await r.f.settle();
  // Then
  assert.equal(r.f.api.nodes.length, 7);
  assert.equal(r.requests.length, 1); assert.equal(r.requests[0].prompt, 'Original instructions');
  assert.equal(r.f.api.nodes.find(node => node.id === 3).imageUrl, 'data:image/png;base64,YQ==');
  assert.equal(r.f.api.history.length, 1);
});

test('project navigation during flow planning leaves the pending planning controller intact', async () => {
  // Given
  const opened = [];
  const navigation = { open: project => opened.push(project.id), create() {}, update() {}, isBusy: () => false, deleted() {} };
  const f = persistenceHarness({ navigation }); f.render(); await f.settle();
  const controller = new AbortController(); f.api.planningRef.current = controller;
  // When
  await f.api.openProject({ id: 'B', name: 'B', updatedAt: '' });
  // Then
  assert.deepEqual(opened, ['B']); assert.equal(f.api.planningRef.current, controller); assert.equal(controller.signal.aborted, false);
});

test('a running background project cannot be deleted from another workspace', async () => {
  // Given
  const navigation = { open() {}, create() {}, update() {}, isBusy: id => id === 'A', deleted() {} };
  const f = persistenceHarness({ navigation }); f.render(); await f.settle();
  f.metadata.set('gpt-node-studio-project-A', 'original');
  // When
  await f.api.deleteProject({ id: 'A', name: 'A' }); f.render();
  // Then
  assert.equal(f.metadata.get('gpt-node-studio-project-A'), 'original'); assert.match(f.api.message, /작업 중/);
});
