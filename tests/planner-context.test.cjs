const test = require('node:test');
const assert = require('node:assert/strict');
require('./load-ts.cjs');
const { planningPrompt } = require('../web/app/workflow-plan.ts');
const { editingPrompt } = require('../web/app/workflow-edit.ts');
const { hostedBridge } = require('../web/app/api/hosted-bridge.ts');
const { validatePlan, instructions, requestInstructions } = require('../bridge/planner-contract');
const { compactWorkflowContext } = require('../web/app/planning-context.ts');
const { COMMAND_CATEGORIES } = require('../web/app/command-catalog.ts');

function fixture() {
  const repeated = 'preserve-labels-and-shape;'.repeat(25);
  const commonStyle = { background: 'original', lighting: 'soft', tone: 'warm', ratio: 'portrait' };
  return { projectId: 'project', request: 'original-request', edges: [], nodes: [
    { id: 1, type: 'image', x: 0, y: 0, images: [{ id: 'photo', name: 'source', url: 'data:image/png;base64,YQ==' }], batchOutput: 'each' },
    ...[2, 3, 4, 5].map(id => ({ id, type: 'prompt', x: id, y: id, prompt: repeated, taskTitle: `stage-${id}`, taskDetail: `detail-${id}`, commonStyle })),
  ] };
}
function expanded(workflow) {
  return workflow.nodes.map(node => Object.fromEntries(Object.entries(node).map(([key, value]) =>
    ['promptRef', 'taskTitleRef', 'taskDetailRef', 'commonStyleRef'].includes(key)
      ? [key.slice(0, -3), workflow.definitions[value]] : [key, value])));
}

test('create envelope preserves original request and input metadata without shipping the command catalogue', () => {
  // Given
  const request = '  original\nrequest with constraints  ', name = 'n'.repeat(120), scope = 's'.repeat(120);
  // When
  const body = JSON.parse(planningPrompt(request, { images: [{ id: 'i', name, url: 'data:image/png;base64,YQ==' }], scope }));
  // Then
  assert.equal(body.request, request);
  assert.equal(body.operation, 'create');
  assert.equal(body.context.scope, scope);
  assert.deepEqual(body.context.images, [{ index: 0, name }]);
  assert.equal(body.context.availableCommands, undefined);
  assert.equal(body.context.commandCatalog, 'frameflow-commands-v1');
  assert.equal(JSON.stringify(body).includes('base64'), false);
});
test('edit envelope losslessly references repeated constraints and retains all node instructions', () => {
  // Given
  const snapshot = fixture(), request = '  requested change\n  ';
  // When
  const body = JSON.parse(editingPrompt(request, snapshot, 'scope'));
  const nodes = expanded(body.context.workflow);
  // Then
  assert.equal(body.request, request);
  assert.equal(body.operation, 'edit');
  assert.equal(body.context.workflow.request, snapshot.request);
  assert.deepEqual(body.context.workflow.edges, snapshot.edges.map(edge => ({ source: edge.source, target: edge.target })));
  assert.ok(body.context.workflow.definitions.length > 0);
  for (const node of nodes.slice(1)) {
    const original = snapshot.nodes.find(item => item.id === node.id);
    assert.equal(node.prompt, original.prompt);
    assert.equal(node.taskTitle, original.taskTitle);
    assert.equal(node.taskDetail, original.taskDetail);
    assert.deepEqual(node.commonStyle, original.commonStyle);
  }
  assert.deepEqual(nodes[0].imageIndices, [0]);
  assert.equal(JSON.stringify(body).includes('base64'), false);
  const flat = { ...body.context.workflow, nodes }; delete flat.definitions;
  assert.ok(JSON.stringify(body.context.workflow).length < JSON.stringify(flat).length);
});
test('fixed planner definitions carry the complete command set in the same provider request', () => {
  // Given / When
  const definitions = JSON.parse(instructions.split('\nPlannerDefinitions: ')[1]);
  // Then
  assert.deepEqual(definitions.commandCatalog.items, COMMAND_CATEGORIES.flatMap(category => category.commands.map(command => `/${command.code}: ${command.label}`)));
  assert.equal(definitions.commandCatalog.id, 'frameflow-commands-v1');
  assert.equal(definitions.styleKeywords.id, 'frameflow-style-keywords-v1');
  assert.ok(definitions.styleKeywords.keywords.some(keyword => keyword.key === 'wormview' && keyword.aliases.includes('웜즈아이')));
});
test('short or unique values stay inline and compact context leaves its source unchanged', () => {
  // Given
  const workflow = { request: 'original', nodes: [{ id: 1, type: 'prompt', prompt: 'unique' }, { id: 2, type: 'prompt', prompt: 'unique' }], edges: [{ source: 1, target: 2 }] };
  const original = JSON.stringify(workflow);
  // When
  const compact = compactWorkflowContext(workflow);
  // Then
  assert.equal(compact, workflow);
  assert.equal(JSON.stringify(workflow), original);
});
test('fixed definitions remain a shared provider prefix while decoding rules follow request structure', () => {
  // Given
  const create = planningPrompt('task', { images: [], scope: 'all' });
  const edit = editingPrompt('change', fixture(), 'scope');
  // When
  const createRules = requestInstructions(create), editRules = requestInstructions(edit);
  // Then
  assert.equal(createRules, instructions);
  assert.ok(editRules.startsWith(instructions));
  assert.ok(editRules.includes('promptRef'));
  assert.equal(requestInstructions('plain-text-task'), instructions);
});
test('motion requests force the executable motion node instead of a sprite-sheet workaround', () => {
  const rules = requestInstructions(JSON.stringify({ operation: 'create', request: '스프라이트를 걷는 GIF 모션으로 만들어줘', context: {} }));
  assert.match(rules, /HARD MOTION REQUIREMENT/);
  assert.match(rules, /MUST use a motion node/);
  assert.match(rules, /browser encodes the final looping GIF immediately/);
});
test('invalid graph returns a specific cycle code without relaxing validation', () => {
  // Given
  const plan = { summary: 'graph', warnings: [], nodes: [{ id: 1, type: 'prompt', prompt: 'instruction' }, { id: 2, type: 'generate', prompt: null }, { id: 3, type: 'preview', prompt: null }], edges: [{ source: 1, target: 2 }, { source: 2, target: 1 }, { source: 2, target: 3 }] };
  // When / Then
  assert.throws(() => validatePlan(plan), { message: 'provider_plan_invalid', planReason: 'cycle' });
});
test('repair carries diagnostics separately while preserving the complete original envelope', async () => {
  // Given
  const saved = { fetch: global.fetch, mode: process.env.FRAMEFLOW_SERVER_MODE, key: process.env.FRAMEFLOW_SERVER_BRIDGE_KEY };
  process.env.FRAMEFLOW_SERVER_MODE = '1'; process.env.FRAMEFLOW_SERVER_BRIDGE_KEY = 'k'.repeat(43);
  const body = JSON.parse(editingPrompt('  exact user request  ', fixture(), 'scope')), calls = [];
  global.fetch = async (url, options) => {
    if (url.endsWith('/status')) return Response.json({ canRun: true });
    calls.push(JSON.parse(options.body));
    return calls.length === 1 ? Response.json({ error: 'provider_plan_invalid', planReason: 'cycle' }, { status: 502 }) : Response.json({ mode: 'gpt' });
  };
  try {
    // When
    const request = new Request('http://127.0.0.1:4310/plan', { method: 'POST', headers: { host: '127.0.0.1:4310', origin: 'http://127.0.0.1:4310', cookie: `frameflow_server_session=${'s'.repeat(43)}` }, body: JSON.stringify({ prompt: JSON.stringify(body) }) });
    const response = await hostedBridge(request, { path: '/remote/v1/plan', method: 'POST', operation: 'plan' });
    // Then
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    const repaired = JSON.parse(calls[1].prompt);
    assert.equal(repaired.request, body.request);
    assert.deepEqual(repaired.context, body.context);
    assert.deepEqual(repaired.repair, { attempt: 1, validationCode: 'cycle' });
  } finally {
    global.fetch = saved.fetch;
    for (const [key, value] of Object.entries({ FRAMEFLOW_SERVER_MODE: saved.mode, FRAMEFLOW_SERVER_BRIDGE_KEY: saved.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
