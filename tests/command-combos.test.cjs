const test = require('node:test');
const assert = require('node:assert/strict');
require('./load-ts.cjs');
const { validatePlan, requestInstructions } = require('../bridge/planner-contract');
const catalog = require('../shared/command-catalog.json');
const { executeWorkflow } = require('../web/app/workflow-engine.ts');
const node = (id, type, prompt = null) => ({ id, type, prompt, taskTitle: `단계 ${id}`, taskDetail: '피사체를 보존하여 연출', inputMode: null, imageIndex: null, commonStyle: null });
const plan = prompt => ({ summary: '스트리트 사진 생성', warnings: [], nodes: [node(1, 'command', prompt), node(2, 'generate'), node(3, 'preview')], edges: [{ source: 1, target: 2 }, { source: 2, target: 3 }] });

test('mixed command instructions are separated losslessly without extra image operations', () => {
  const input = plan('/BLACKWHITE /HIGHANGLE 인물과 강아지의 위치를 그대로 유지');
  const original = JSON.stringify(input);
  const result = validatePlan(input);
  assert.equal(result.nodes.find(n => n.id === 1).prompt, '/BLACKWHITE /HIGHANGLE');
  const instruction = result.nodes.find(n => n.type === 'prompt');
  assert.equal(instruction.prompt, '인물과 강아지의 위치를 그대로 유지');
  assert.ok(result.edges.some(e => e.source === 1 && e.target === instruction.id));
  assert.ok(result.edges.some(e => e.source === instruction.id && e.target === 2));
  assert.equal(result.nodes.filter(n => n.type === 'generate').length, 1);
  assert.equal(JSON.stringify(input), original);
});

test('pure combined commands remain one node and prose-only command becomes a prompt', () => {
  assert.equal(validatePlan(plan('/BLACKWHITE /HIGHANGLE')).nodes.length, 3);
  assert.equal(validatePlan(plan('피사체의 위치 보존')).nodes[0].type, 'prompt');
});

test('unknown command codes are diagnosed instead of silently discarded', () => {
  assert.throws(() => validatePlan(plan('/IMAGINARYCAMERA')), error => error.planReason === 'command_code' && error.planNode === 1);
});

test('street recipes use only the original command vocabulary and keep scene details separate', () => {
  const recipe = catalog.recipes.find(r => r.id === 'street-shadow');
  const supported = new Set(catalog.categories.flatMap(c => c.commands.map(command => command.code)));
  assert.equal(supported.size, 161);
  for (const code of ['STREETPHOTO', 'LONGSHADOWS', 'HIGHCONTRAST', 'NEGATIVESPACE', 'DIAGONALCOMPOSITION']) assert.ok(!supported.has(code), code);
  for (const item of catalog.recipes) for (const code of item.codes) assert.ok(supported.has(code), code);
  for (const code of ['HIGHANGLE', 'BLACKWHITE', 'HARDLIGHT', 'SIDELIGHT', 'CANDID', 'DSLR']) assert.ok(recipe.codes.includes(code));
  assert.equal(validatePlan(plan(recipe.codes.map(code => `/${code}`).join(' '))).nodes.length, 3);
});

test('combined command meanings and scene preservation reach the actual image request together', async () => {
  const graph = validatePlan(plan('/CANDID /SIDELIGHT /BLACKWHITE 인물과 강아지의 위치 유지. 긴 대각선 그림자와 거친 포장도로'));
  const calls = [];
  await executeWorkflow({ ...graph, request: '', normalizeImage: async image => image, execute: async request => { calls.push(request); return 'data:image/png;base64,YQ=='; } });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].prompt.includes('인물과 강아지의 위치 유지'));
  assert.ok(calls[0].prompt.includes('자연스러운 스냅'));
  assert.ok(calls[0].prompt.includes('측면 조명'));
  assert.ok(calls[0].prompt.includes('긴 대각선 그림자와 거친 포장도로'));
});

test('editorial, newtro and daily street moods have distinct existing-command combinations', () => {
  const editorial = catalog.recipes.find(r => r.id === 'street-editorial');
  const newtro = catalog.recipes.find(r => r.id === 'street-newtro');
  const daily = catalog.recipes.find(r => r.id === 'street-candid');
  assert.ok(editorial.codes.includes('FASHIONCAMPAIGN') && editorial.codes.includes('EDITORIAL'));
  assert.ok(newtro.codes.includes('VINTAGE') && newtro.codes.includes('GOLDENHOUR'));
  assert.ok(daily.codes.includes('CANDID') && daily.codes.includes('IPHONE'));
  for (const recipe of [editorial, newtro, daily]) assert.ok(!recipe.codes.includes('BLACKWHITE'));
  assert.ok(editorial.description.includes('프롬프트'));
  assert.ok(daily.description.includes('프롬프트'));
});

test('create and edit planning receive the same original-command mood recipes', async () => {
  for (const operation of ['create', 'edit']) {
    const rules = requestInstructions(JSON.stringify({ operation, request: '흑백 없이 자연스러운 데일리 스트릿 스냅', context: {} }));
    const definitions = JSON.parse(rules.split('\nPlannerDefinitions: ')[1].split('\n')[0]);
    assert.equal(definitions.commandCatalog.items.length, 161);
    assert.deepEqual(definitions.commandCatalog.recipes, catalog.recipes);
  }
  const recipe = catalog.recipes.find(r => r.id === 'street-candid');
  const graph = validatePlan({ summary: '데일리 스냅으로 편집', warnings: [], nodes: [node(1, 'image'), node(2, 'command', recipe.codes.map(code => `/${code}`).join(' ') + ' 골목을 걷는 자연스러운 모습. 얼굴과 기존 데님 착장 보존, 흑백 금지'), node(3, 'edit'), node(4, 'preview')], edges: [{ source: 1, target: 2 }, { source: 2, target: 3 }, { source: 3, target: 4 }] });
  const calls = [];
  await executeWorkflow({ ...graph, nodes: graph.nodes.map(n => n.type === 'image' ? { ...n, imageUrl: 'data:image/png;base64,YQ==' } : n), request: '', normalizeImage: async image => image, execute: async request => { calls.push(request); return 'data:image/png;base64,YQ=='; } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'edit');
  assert.ok(calls[0].prompt.includes('얼굴과 기존 데님 착장 보존, 흑백 금지'));
  assert.ok(!calls[0].prompt.includes('/BLACKWHITE'));
});

test('normalization preserves branching and rejects original cycles before rewriting', () => {
  const input = plan('/BLACKWHITE 피사체 보존');
  input.nodes.push(node(4, 'generate'), node(5, 'preview'));
  input.edges.push({ source: 1, target: 4 }, { source: 4, target: 5 });
  const result = validatePlan(input), instruction = result.nodes.find(n => n.type === 'prompt');
  assert.deepEqual(result.edges.filter(e => e.source === instruction.id).map(e => e.target), [2, 4]);
  input.edges.push({ source: 2, target: 1 });
  assert.throws(() => validatePlan(input), error => error.planReason === 'cycle');
});
