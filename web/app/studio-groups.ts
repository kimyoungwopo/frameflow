import type { NodeType, WorkflowEdge, WorkflowNode } from './workflow-engine';
import { workflowGroups } from './workflow-engine';
import type { StudioImage, BatchOutput } from './shared-flow';

export type StudioGroup = { id: string; name: string };
export type GroupedNode = WorkflowNode & { readonly groupId?: string; readonly x: number; readonly y: number };
export const MAX_BATCH_IMAGES = 12;
export const HISTORY_LIMIT = 60;

export function parseGroups(value: unknown, nodes: readonly GroupedNode[], edges: readonly WorkflowEdge[] = []): StudioGroup[] {
  if (value === undefined) {
    if (nodes.some(node => node.groupId !== undefined)) throw new Error('노드의 그룹을 찾지 못했어요.');
    return [];
  }
  if (!Array.isArray(value) || value.length > 100) throw new Error('그룹 정보를 읽지 못했어요.');
  const ids = new Set<string>();
  const groups = value.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || !('id' in raw) || !('name' in raw) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 100 || ids.has(raw.id) || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 100) throw new Error('유효하지 않은 그룹 정보예요.');
    ids.add(raw.id);
    return { id: raw.id, name: raw.name };
  });
  if (nodes.some(node => node.groupId !== undefined && !ids.has(node.groupId))) throw new Error('노드의 그룹을 찾지 못했어요.');
  const membership = new Map(nodes.map(node => [node.id, node.groupId]));
  if (edges.some(edge => membership.get(edge.source) !== membership.get(edge.target))) throw new Error('연결된 체인은 같은 그룹으로 묶어 주세요.');
  return groups.filter(group => nodes.some(node => node.groupId === group.id));
}

export function groupBounds(nodes: readonly GroupedNode[]) {
  const x = Math.min(...nodes.map(node => node.x)) - 22;
  const y = Math.min(...nodes.map(node => node.y)) - 62;
  return { x, y, width: Math.max(...nodes.map(node => node.x + (node.type === 'image' ? 250 : 190))) - x + 22, height: Math.max(...nodes.map(node => node.y + (node.type === 'command' ? 380 : 260))) - y + 22 };
}

export function expandedGroupIds(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], selectedIds: readonly number[]): Set<number> {
  const selected = new Set(selectedIds);
  return new Set(workflowGroups(nodes, edges, null).filter(chain => chain.some(node => selected.has(node.id))).flatMap(chain => chain.map(node => node.id)));
}

export function buildCutoutBatch(images: readonly { url: string; name: string }[], base: number, groupId: string, y: number) {
  if (!images.length || images.length > MAX_BATCH_IMAGES) throw new Error(`이미지는 한 번에 ${MAX_BATCH_IMAGES}장까지 선택해 주세요.`);
  const nodes: { id: number; type: NodeType; x: number; y: number; groupId: string; imageUrl?: string; imageName?: string; prompt?: string }[] = [];
  const edges: { id: number; source: number; target: number }[] = [];
  images.forEach((image, index) => {
    const id = base + index * 10;
    const row = y + index * 430;
    nodes.push(
      { id, type: 'image', x: 70, y: row, groupId, imageUrl: image.url, imageName: image.name },
      { id: id + 1, type: 'command', x: 360, y: row, groupId, prompt: '/REMOVEBG Preserve the original subject, shape, colors, fine edges and details. Only remove the background. Do not invent new objects or text.' },
      { id: id + 2, type: 'edit', x: 600, y: row, groupId },
      { id: id + 3, type: 'preview', x: 840, y: row, groupId, imageName: `${image.name} · 누끼` },
    );
    edges.push({ id: id + 4, source: id, target: id + 1 }, { id: id + 5, source: id + 1, target: id + 2 }, { id: id + 6, source: id + 2, target: id + 3 });
  });
  return { nodes, edges };
}

export function buildSharedCutout(images: readonly StudioImage[], base: number, groupId: string, y: number, output: BatchOutput = 'each') {
  if (!images.length || images.length > MAX_BATCH_IMAGES) throw new Error(`이미지는 한 번에 ${MAX_BATCH_IMAGES}장까지 선택해 주세요.`);
  const nodes = [
    { id: base, type: 'image' as const, x: 70, y, groupId, images, batchOutput: output, imageUrl: images[0].url, imageName: `${images.length}장 입력` },
    { id: base + 1, type: 'command' as const, x: 360, y, groupId, prompt: '/REMOVEBG Preserve the original subject, shape, colors, fine edges and details. Only remove the background. Do not invent new objects or text.' },
    { id: base + 2, type: 'edit' as const, x: 600, y, groupId },
    { id: base + 3, type: 'preview' as const, x: 840, y, groupId },
  ];
  const edges = [{ id: base + 4, source: base, target: base + 1 }, { id: base + 5, source: base + 1, target: base + 2 }, { id: base + 6, source: base + 2, target: base + 3 }];
  return { nodes, edges };
}
