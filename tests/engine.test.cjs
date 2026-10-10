const test = require('node:test');
const assert = require('node:assert/strict');
require('./load-ts.cjs');
const { executeWorkflow, validateWorkflow, workflowGroups } = require('../web/app/workflow-engine.ts');
const { imageOutputFormat } = require('../web/app/image-format.ts');
const node = (id, type, extra = {}) => ({ id, type, ...extra });
const edge = (source, target) => ({ source, target });
const run = (nodes, edges, execute) => executeWorkflow({ nodes, edges, request: 'keep subject', execute, normalizeImage: async (image) => image });

test('PNG and WebP files retain alpha; JPEG remains compressed JPEG', () => {
  assert.equal(imageOutputFormat(new Blob([], { type: 'image/png' })), 'image/png');
  assert.equal(imageOutputFormat(new Blob([], { type: 'image/webp' })), 'image/png');
  assert.equal(imageOutputFormat('https://example.invalid/result.png'), 'image/png');
  assert.equal(imageOutputFormat(new Blob([], { type: 'image/jpeg' })), 'image/jpeg');
});
test('independent edited branches feed BLEND their own results', async () => {
  const calls = [];
  await run([node(1, 'image', { imageUrl: 'a' }), node(2, 'image', { imageUrl: 'b' }), node(3, 'edit'), node(4, 'edit'), node(5, 'blend'), node(6, 'preview')], [edge(1, 3), edge(2, 4), edge(3, 5), edge(4, 5), edge(5, 6)], async (stage) => { calls.push(stage); return `result-${calls.length}`; });
  assert.deepEqual(calls.map((stage) => stage.imageUrls), [['a'], ['b'], ['result-1', 'result-2']]);
});
test('command configuration is consumed once and transparency stays in its branch', async () => {
  const calls = [];
  await run([node(1, 'image', { imageUrl: 'original' }), node(2, 'command', { prompt: '/REMOVEBG' }), node(3, 'edit'), node(4, 'preview'), node(5, 'edit'), node(6, 'preview')], [edge(1, 3), edge(2, 3), edge(3, 4), edge(1, 5), edge(5, 6)], async (stage) => { calls.push(stage); return `result-${calls.length}`; });
  assert.equal(calls.length, 2);
  const cutout = calls.find((stage) => stage.prompt.includes('/REMOVEBG'));
  const other = calls.find((stage) => !stage.prompt.includes('/REMOVEBG'));
  assert.ok(cutout);
  assert.ok(other);
  assert.equal(cutout.background, 'transparent');
  assert.equal(other.background, undefined);
});
test('REPEAT executes bounded passes using each preceding result', async () => {
  const calls = [];
  await run([node(1, 'image', { imageUrl: 'original' }), node(2, 'repeat', { prompt: 'REPEAT:99' }), node(3, 'preview')], [edge(1, 2), edge(2, 3)], async (stage) => { calls.push(stage); return `result-${calls.length}`; });
  assert.equal(calls.length, 5);
  assert.deepEqual(calls[4].imageUrls, ['result-4']);
});
test('invalid graphs fail before executing any provider call', async () => {
  let calls = 0;
  await assert.rejects(run([node(1, 'image', { imageUrl: 'a' }), node(2, 'edit'), node(3, 'preview')], [edge(1, 2), edge(2, 1), edge(2, 3)], async () => { calls++; return 'wrong'; }), /순환/);
  assert.equal(calls, 0);
  assert.throws(() => validateWorkflow([node(1, 'edit'), node(2, 'preview')], [edge(1, 2)], 'edit'), /입력 이미지/);
});
test('selected disconnected workflow excludes all unrelated components', () => {
  const groups = workflowGroups([node(1, 'prompt'), node(2, 'generate'), node(3, 'preview'), node(4, 'image'), node(5, 'preview')], [edge(1, 2), edge(2, 3), edge(4, 5)], 2);
  assert.deepEqual(groups.map((group) => group.map((item) => item.id)), [[1, 2, 3]]);
});

test('selected workflow runs when an unrelated component contains a cycle', async () => {
  const nodes = [node(1, 'image', { imageUrl: 'a' }), node(2, 'edit'), node(3, 'preview'), node(4, 'command'), node(5, 'command')];
  const edges = [edge(1, 2), edge(2, 3), edge(4, 5), edge(5, 4)];
  const calls = [];
  const groups = workflowGroups(nodes, edges, 2);
  for (const group of groups) await run(group, edges.filter(item => group.some(node => node.id === item.source)), async stage => { calls.push(stage); return 'result'; });
  assert.deepEqual(calls.map(stage => stage.imageUrls), [['a']]);
});

test('group selection includes every selected component when an unrelated component contains a cycle', () => {
  const nodes = [node(1, 'image'), node(2, 'preview'), node(3, 'image'), node(4, 'preview'), node(5, 'command'), node(6, 'command')];
  const edges = [edge(1, 2), edge(3, 4), edge(5, 6), edge(6, 5)];
  const groups = workflowGroups(nodes, edges, [1, 2, 4]);
  assert.deepEqual(groups.map(group => group.map(item => item.id)), [[1, 2], [3, 4]]);
});

for (const selected of [null, 4, [1, 4]]) test(`cycle remains invalid when included in execution scope ${JSON.stringify(selected)}`, () => {
  const nodes = [node(1, 'image'), node(2, 'preview'), node(4, 'command'), node(5, 'command')];
  const edges = [edge(1, 2), edge(4, 5), edge(5, 4)];
  assert.throws(() => workflowGroups(nodes, edges, selected), { name: 'WorkflowExecutionError', code: 'workflow_invalid' });
});

test('selected workflow rejects its dangling edge instead of filtering it away', () => {
  const nodes = [node(1, 'image'), node(2, 'preview')];
  const edges = [edge(1, 2), edge(2, 99)];
  assert.throws(() => workflowGroups(nodes, edges, 1), { name: 'WorkflowExecutionError', code: 'workflow_invalid' });
});

for (const reverse of [false, true]) test(`NEWBG overrides a transparent sibling input with reversed edges ${reverse}`, async () => {
  const nodes = [node(1, 'image', { imageUrl: 'a' }), node(2, 'command', { prompt: '/REMOVEBG' }), node(3, 'edit'), node(4, 'command', { prompt: '/NEWBG' }), node(5, 'edit'), node(6, 'preview'), node(7, 'upscale'), node(8, 'preview')];
  const edges = [edge(1, 3), edge(2, 3), edge(3, 5), edge(4, 5), edge(5, 6), edge(3, 7), edge(7, 8)];
  const calls = [];
  await run(nodes, reverse ? edges.toReversed() : edges, async stage => { calls.push(stage); return `result-${calls.length}`; });
  const replacement = calls.find(stage => stage.prompt.split(/\s+/).includes('/NEWBG'));
  assert.ok(replacement);
  assert.equal(replacement.background, undefined);
  assert.deepEqual(calls.filter(stage => stage !== replacement).map(stage => stage.background), ['transparent', 'transparent']);
});

test('NEWBG reset is consumed so a later cutout can request transparency again', async () => {
  const nodes = [node(1, 'image', { imageUrl: 'a' }), node(2, 'command', { prompt: '/REMOVEBG' }), node(3, 'edit'), node(4, 'command', { prompt: '/NEWBG' }), node(5, 'edit'), node(6, 'command', { prompt: '/REMOVEBG' }), node(7, 'edit'), node(8, 'preview')];
  const edges = [edge(1, 3), edge(2, 3), edge(3, 4), edge(4, 5), edge(5, 7), edge(6, 7), edge(7, 8)];
  const calls = [];
  await run(nodes, edges, async stage => { calls.push(stage); return `result-${calls.length}`; });
  assert.deepEqual(calls.map(stage => stage.background), ['transparent', undefined, 'transparent']);
});
