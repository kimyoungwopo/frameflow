const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../web/node_modules/typescript');

test('image upload label bypasses node drag capture while the node body remains draggable', () => {
  const source = fs.readFileSync(require.resolve('../web/app/page.tsx'), 'utf8');
  const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'onPointerDown' && node.initializer && ts.isJsxExpression(node.initializer)) {
      const expression = node.initializer.expression;
      if (expression && expression.getText(tree).includes('setPointerCapture')) handler = expression.getText(tree);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(handler, 'node pointer handler exists');
  let captures = 0;
  let drags = 0;
  const context = { executionRef: { current: null }, planningRef: { current: null }, node: { id: 1, x: 0, y: 0 }, setSelectedGroup() {}, setSelected() {}, setDrag() { drags += 1; } };
  vm.createContext(context);
  const run = vm.runInContext(ts.transpile(`(${handler})`, { target: ts.ScriptTarget.ES2022 }), context);
  const event = (label) => ({ target: { closest: selector => label && selector === 'label' ? {} : null }, currentTarget: { setPointerCapture() { captures += 1; } }, pointerId: 1, clientX: 10, clientY: 10 });
  run(event(true));
  assert.equal(captures, 0);
  assert.equal(drags, 0);
  run(event(false));
  assert.equal(captures, 1);
  assert.equal(drags, 1);
});
