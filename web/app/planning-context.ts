type WorkflowContext = {
  readonly request: string;
  readonly nodes: readonly Readonly<Record<string, unknown>>[];
  readonly edges: readonly { readonly source: number; readonly target: number }[];
};
const referenceFields = new Set(['prompt', 'taskTitle', 'taskDetail', 'commonStyle']);

export function compactWorkflowContext(workflow: WorkflowContext) {
  const occurrences = new Map<string, { readonly value: unknown; count: number }>();
  for (const node of workflow.nodes) for (const [field, value] of Object.entries(node)) {
    if (!referenceFields.has(field) || value === null || value === undefined) continue;
    const key = JSON.stringify(value);
    const entry = occurrences.get(key);
    if (entry) entry.count++;
    else occurrences.set(key, { value, count: 1 });
  }
  const definitions = [...occurrences.values()].filter(entry => entry.count > 1 && JSON.stringify(entry.value).length > 40).map(entry => entry.value);
  if (!definitions.length) return workflow;
  const references = new Map(definitions.map((value, index) => [JSON.stringify(value), index]));
  const nodes = workflow.nodes.map(node => Object.fromEntries(Object.entries(node).map(([field, value]) => {
    const index = referenceFields.has(field) ? references.get(JSON.stringify(value)) : undefined;
    return index === undefined ? [field, value] : [`${field}Ref`, index];
  })));
  const compact = { ...workflow, nodes, definitions };
  return JSON.stringify(compact).length < JSON.stringify(workflow).length ? compact : workflow;
}
