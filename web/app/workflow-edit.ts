import { materializePlan, planningSources, PlanError } from './workflow-plan';
import { COMMAND_CATALOG_ID } from './command-catalog';
import { compactWorkflowContext } from './planning-context';
import { orderWorkflow } from './workflow-engine';
import type { parseProjectBackup } from './project-backup';

export type EditNode = ReturnType<typeof parseProjectBackup>['nodes'][number];
type EditEdge = { readonly id: number; readonly source: number; readonly target: number };
export type EditGraph<T extends EditNode = EditNode> = { readonly nodes: readonly T[]; readonly edges: readonly EditEdge[]; readonly request: string };
export type EditSnapshot<T extends EditNode = EditNode> = EditGraph<T> & { readonly projectId: string };

export function snapshotFlow<T extends EditNode>(projectId: string, graph: EditGraph<T>, scope: readonly number[]): EditSnapshot<T> {
  const ids = new Set(scope), nodes = graph.nodes.filter(node => ids.has(node.id));
  if (!nodes.length || nodes.length > 64) throw new PlanError('수정할 플로우를 선택해 주세요. 한 번에 64개 노드까지 수정할 수 있어요.');
  if (new Set(nodes.map(node => node.groupId)).size > 1) throw new PlanError('한 그룹 또는 그룹에 속하지 않은 플로우를 선택해 주세요.');
  if (graph.edges.some(edge => ids.has(edge.source) !== ids.has(edge.target))) throw new PlanError('선택 범위 밖의 노드와 연결되어 있어요. 연결된 플로우 전체를 선택해 주세요.');
  const edges = graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  if (edges.length > 128) throw new PlanError('연결이 많은 플로우예요. 수정할 범위를 더 작은 그룹으로 선택해 주세요.');
  orderWorkflow(nodes, edges);
  return { projectId, nodes, edges, request: graph.request };
}

export function snapshotMatches<T extends EditNode>(snapshot: EditSnapshot<T>, projectId: string, graph: EditGraph<T>): boolean {
  if (snapshot.projectId !== projectId || snapshot.request !== graph.request) return false;
  const ids = new Set(snapshot.nodes.map(node => node.id));
  if (snapshot.nodes.some(node => graph.nodes.find(current => current.id === node.id) !== node)) return false;
  const touching = graph.edges.filter(edge => ids.has(edge.source) || ids.has(edge.target));
  return touching.length === snapshot.edges.length && snapshot.edges.every(edge => touching.includes(edge));
}

export function editingPrompt(instruction: string, snapshot: EditSnapshot, scope: string): string {
  if (!instruction.trim() || instruction.length > 4000) throw new PlanError('수정 요청은 1~4,000자로 입력해 주세요.');
  const sources = planningSources(snapshot.nodes);
  const images = sources.map((image, index) => ({ index, name: image.name }));
  const workflow = {
    request: snapshot.request,
    nodes: snapshot.nodes.map(node => ({ id: node.id, type: node.type, prompt: node.prompt ?? null, taskTitle: node.taskTitle || node.type, taskDetail: node.taskDetail ?? null, commonStyle: node.commonStyle || null, inputMode: node.type === 'image' ? node.images !== undefined ? node.batchOutput || 'each' : 'single' : null, imageIndices: node.type === 'image' ? sources.flatMap((image, index) => node.images?.some(source => source.id === image.id) || (!node.images && image.id === `source-${node.id}`) ? [index] : []) : [] })),
    edges: snapshot.edges.map(edge => ({ source: edge.source, target: edge.target })),
  };
  const context = { scope, images, workflow: compactWorkflowContext(workflow), commonStyle: snapshot.nodes.find(node => node.commonStyle)?.commonStyle || null, outputMode: snapshot.nodes.find(node => node.images)?.batchOutput || 'each', commandCatalog: COMMAND_CATALOG_ID };
  const prompt = JSON.stringify({ operation: 'edit', request: instruction, context });
  if (prompt.length > 8000) throw new PlanError('플로우 설명이 너무 길어요. 수정할 작업을 더 작은 그룹으로 선택해 주세요.');
  return prompt;
}

export function prepareFlowEdit(value: unknown, snapshot: EditSnapshot, base: number) {
  const sources = planningSources(snapshot.nodes);
  const built = materializePlan(value, sources, { base, groupId: snapshot.nodes[0].groupId || 'edit', y: Math.min(...snapshot.nodes.map(node => node.y)), output: snapshot.nodes.find(node => node.images)?.batchOutput });
  const raw: unknown = value && typeof value === 'object' ? Reflect.get(value, 'nodes') : undefined;
  if (!Array.isArray(raw)) throw new PlanError('수정할 작업 노드를 읽지 못했어요.');
  const oldIds = raw.map((node: unknown) => { const id: unknown = node && typeof node === 'object' ? Reflect.get(node, 'id') : undefined; if (typeof id !== 'number') throw new PlanError('수정할 노드 ID를 읽지 못했어요.'); return id; });
  const ids = new Map<number, number>(), originals = new Map(snapshot.nodes.map(node => [node.id, node]));
  const xOffset = Math.min(...snapshot.nodes.map(node => node.x)) - Math.min(...built.nodes.map(node => node.x));
  const nodes = built.nodes.map((node, index) => {
    const original = originals.get(oldIds[index]);
    const id = original?.type === node.type ? original.id : node.id;
    ids.set(node.id, id);
    const inputMode: unknown = raw[index] && typeof raw[index] === 'object' ? Reflect.get(raw[index], 'inputMode') : undefined;
    const preserveInput = original?.type === 'image' && node.type === 'image' && ((original.images !== undefined && (inputMode === 'each' || inputMode === 'sheet')) || (original.images === undefined && inputMode === 'single'));
    return { ...node, id, x: node.x + xOffset, groupId: original?.groupId ?? snapshot.nodes[0].groupId, ...(preserveInput ? { imageUrl: original.imageUrl, imageName: original.imageName, images: original.images } : {}) };
  });
  const edges = built.edges.map(edge => {
    const source = ids.get(edge.source), target = ids.get(edge.target);
    if (source === undefined || target === undefined) throw new PlanError('수정할 작업 연결을 읽지 못했어요.');
    const original = snapshot.edges.find(item => item.source === source && item.target === target);
    return { id: original?.id ?? edge.id, source, target };
  });
  const comparable = (node: EditNode) => JSON.stringify({ type: node.type, prompt: node.prompt, commonStyle: node.commonStyle, batchOutput: node.batchOutput, taskTitle: node.taskTitle, taskDetail: node.taskDetail });
  const nodeIds = new Set(nodes.map(node => node.id));
  const diff = { added: nodes.filter(node => !originals.has(node.id)).length, removed: snapshot.nodes.filter(node => !nodeIds.has(node.id)).length, changed: nodes.filter(node => { const original = originals.get(node.id); return original && comparable(original) !== comparable(node); }).length };
  const ordered = orderWorkflow(nodes, edges).flatMap(item => nodes.filter(node => node.id === item.id));
  return { ...built, nodes: ordered, edges, diff };
}

export function replaceFlow<T extends EditNode>(snapshot: EditSnapshot<T>, replacement: EditGraph<T>, current: { readonly projectId: string; readonly graph: EditGraph<T> }): EditGraph<T> {
  if (!snapshotMatches(snapshot, current.projectId, current.graph)) throw new PlanError('플로우가 변경되어 적용할 수 없어요. 현재 작업을 기준으로 다시 요청해 주세요.');
  const ids = new Set(snapshot.nodes.map(node => node.id));
  const nodes = [...current.graph.nodes.filter(node => !ids.has(node.id)), ...replacement.nodes];
  const edges = [...current.graph.edges.filter(edge => !ids.has(edge.source) && !ids.has(edge.target)), ...replacement.edges];
  if (nodes.length > 500 || edges.length > 2000 || new Set(edges.map(edge => edge.id)).size !== edges.length) throw new PlanError('프로젝트 크기와 작업 연결을 확인해 주세요.');
  orderWorkflow(nodes, edges);
  return { nodes, edges, request: current.graph.request };
}
