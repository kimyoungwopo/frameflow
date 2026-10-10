const catalog = require('../shared/command-catalog.json');
const supported = new Set(catalog.categories.flatMap(category => category.commands.map(command => command.code)));

function normalizeCommands(plan, invalid) {
  const nodes = [], additions = [], replacements = new Map();
  let nextId = Math.max(...plan.nodes.map(node => node.id));
  let changed = false;
  for (const node of plan.nodes) {
    if (node.type !== 'command') { nodes.push(node); continue; }
    const codes = [];
    const prose = node.prompt.replace(/(^|\s)\/([A-Za-z0-9]+)(?=\s|$)/g, (token, space, code) => {
      if (!supported.has(code)) throw invalid('command_code', node.id);
      codes.push(`/${code}`);
      return space;
    }).trim();
    if (!codes.length) { nodes.push({ ...node, type: 'prompt' }); changed = true; continue; }
    const prompt = [...new Set(codes)].join(' ');
    nodes.push({ ...node, prompt });
    changed ||= prompt !== node.prompt;
    if (prose) {
      nextId += 1;
      if (!Number.isSafeInteger(nextId)) throw invalid('structure', node.id);
      additions.push({ ...node, id: nextId, type: 'prompt', prompt: prose, taskTitle: '작업 지시', taskDetail: node.taskDetail || '연출에 적용할 장면 설명과 보존 조건' });
      replacements.set(node.id, nextId);
      changed = true;
    }
  }
  if (!changed) return null;
  return {
    summary: plan.review.summary, warnings: plan.review.warnings,
    nodes: [...nodes, ...additions].map(node => ({ ...node, prompt: node.prompt ?? null })),
    edges: [
      ...plan.edges.map(edge => ({ source: replacements.get(edge.source) || edge.source, target: edge.target })),
      ...[...replacements].map(([source, target]) => ({ source, target })),
    ],
  };
}
module.exports = { normalizeCommands };
