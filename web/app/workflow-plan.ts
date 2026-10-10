import { parseProjectBackup } from './project-backup';
import { estimateSharedRequests } from './shared-flow';
import { workflowGroups } from './workflow-engine';
import type { SharedNode, StudioImage, BatchOutput } from './shared-flow';
import type { CommonStyle } from './workflow-tools';
import { COMMAND_CATALOG_ID } from './command-catalog';

type PlanSource = SharedNode & { readonly imageName?: string };
export class PlanError extends Error {}

export function planningSources(nodes: readonly PlanSource[]): StudioImage[] {
  const photos = nodes.filter(node => node.type === 'image').flatMap(node => node.images !== undefined ? node.images : node.imageUrl ? [{ id: `source-${node.id}`, name: node.imageName || '입력 이미지', url: node.imageUrl }] : []);
  const unique = [...new Map(photos.map(photo => [photo.id, photo])).values()];
  if (unique.length > 12) throw new PlanError('자연어로 구성할 입력은 12장까지 선택해 주세요.');
  return unique;
}

export function planningPrompt(request: string, context: { readonly images: readonly StudioImage[]; readonly scope: string; readonly style?: CommonStyle; readonly output?: BatchOutput }): string {
  const prompt = JSON.stringify({ operation: 'create', request, context: { scope: context.scope, images: context.images.map((image, index) => ({ index, name: image.name })), commonStyle: context.style || null, outputMode: context.output || 'each', commandCatalog: COMMAND_CATALOG_ID } });
  if (prompt.length > 8000) throw new PlanError('입력 정보와 함께 보낼 수 있도록 작업 설명을 조금 줄여 주세요.');
  return prompt;
}

export function materializePlan(value: unknown, sources: readonly StudioImage[], placement: { readonly base: number; readonly groupId: string; readonly y: number; readonly output?: BatchOutput }) {
  if (!value || typeof value !== 'object' || Reflect.get(value, 'mode') !== 'gpt') throw new PlanError('GPT 작업 흐름 응답을 확인하지 못했어요.');
  const rawNodes: unknown = Reflect.get(value, 'nodes');
  const rawEdges: unknown = Reflect.get(value, 'edges');
  const review: unknown = Reflect.get(value, 'review');
  if (!Array.isArray(rawNodes) || !rawNodes.length || !Array.isArray(rawEdges) || !review || typeof review !== 'object') throw new PlanError('유효한 작업 흐름을 반환하지 않았어요.');
  const summary: unknown = Reflect.get(review, 'summary');
  const warnings: unknown = Reflect.get(review, 'warnings');
  if (typeof summary !== 'string' || summary.length > 2000 || !Array.isArray(warnings) || warnings.some(warning => typeof warning !== 'string')) throw new PlanError('작업 구성 설명을 읽지 못했어요.');
  const imageInputs = rawNodes.filter((item: unknown) => item && typeof item === 'object' && Reflect.get(item, 'type') === 'image').length;
  const decorated = rawNodes.map((node: unknown) => {
    if (!node || typeof node !== 'object') throw new PlanError('작업 노드를 읽지 못했어요.');
    const inputMode: unknown = Reflect.get(node, 'inputMode');
    const imageIndex: unknown = Reflect.get(node, 'imageIndex');
    if (inputMode != null && !['each', 'sheet', 'single'].includes(String(inputMode))) throw new PlanError('입력 처리 방식을 확인해 주세요.');
    if (imageIndex != null && (typeof imageIndex !== 'number' || !Number.isInteger(imageIndex) || !sources[imageIndex])) throw new PlanError('요청한 입력 사진을 찾지 못했어요. 사진을 추가하고 다시 구성해 주세요.');
    const copy = Object.fromEntries(Object.entries(node));
    if (copy.type !== 'image') return copy;
    const batchMode = inputMode === 'each' || inputMode === 'sheet' ? inputMode : inputMode == null && imageInputs === 1 ? placement.output || 'each' : undefined;
    if (batchMode) return { ...copy, images: [...sources], batchOutput: batchMode, imageUrl: sources[0]?.url || '', imageName: `${sources.length}장 입력` };
    const source = typeof imageIndex === 'number' ? sources[imageIndex] : undefined;
    return { ...copy, imageUrl: source?.url || '', imageName: source?.name || '입력 사진 필요' };
  });
  const parsed = parseProjectBackup({ format: 'gpt-node-studio', version: 1, projectName: '자연어 작업', nodes: decorated, edges: rawEdges, groups: [], history: [], request: '', imageUrl: '', imageName: '' });
  const ids = new Map(parsed.nodes.map((node, index) => [node.id, placement.base + index]));
  const minY = Math.min(...parsed.nodes.map(node => node.y));
  const nodes = parsed.nodes.map((node, index) => ({ ...node, id: placement.base + index, y: node.y - minY + placement.y, groupId: placement.groupId }));
  const edges = parsed.edges.map((edge, index) => {
    const source = ids.get(edge.source), target = ids.get(edge.target);
    if (source === undefined || target === undefined) throw new PlanError('작업 연결을 읽지 못했어요.');
    return { id: placement.base + nodes.length + index, source, target };
  });
  const requests = workflowGroups(nodes, edges, null).reduce((total, chain) => total + estimateSharedRequests(chain), 0);
  const missing = nodes.some(node => node.type === 'image' && !node.imageUrl && !node.images?.length);
  const name = nodes.filter(node => ['generate', 'edit', 'blend', 'upscale', 'repeat', 'motion'].includes(node.type)).map(node => node.taskTitle || node.type).join(' → ').slice(0, 80) || '자연어 작업';
  return { nodes, edges, summary, warnings, requests, missing, name };
}
