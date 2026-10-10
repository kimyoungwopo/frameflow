const test = require('node:test');
const assert = require('node:assert/strict');
const { requestInstructions } = require('../bridge/planner-contract');
const harness = require('../shared/ai-harness.json');

test('planner receives the project AI harness as fixed definitions', () => {
  const rules = requestInstructions(JSON.stringify({ operation: 'create', request: '비 오는 밤길 이미지를 만들어줘', context: {} }));
  const definitions = JSON.parse(rules.split('\nPlannerDefinitions: ')[1].split('\n')[0]);
  assert.deepEqual(definitions.aiHarness, harness);
  assert.equal(definitions.aiHarness.commandNode.allowMultipleCommands, true);
  assert.equal(definitions.aiHarness.commandNode.oneNodePerCombination, true);
});

test('AI harness explicitly protects command combination and motion execution semantics', () => {
  assert.equal(harness.commandNode.unknownCode, 'reject');
  assert.equal(harness.execution.combinedCommandsUseOneImageOperation, true);
  assert.equal(harness.motion.externalConversion, 'reject');
  assert.equal(harness.motion.atlasLayout, 'horizontal_equal_cells');
  assert.equal(harness.motion.oneMotionPerRequest, true);
  assert.deepEqual(harness.motion.requiredFor.slice(0, 6), ['gif', 'apng', 'sprite', 'animation', 'frame', 'motion']);
  assert.equal(harness.safety.preserveOriginalGraphOnFailure, true);
});
