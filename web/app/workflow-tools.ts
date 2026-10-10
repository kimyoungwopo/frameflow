import { orderWorkflow } from './workflow-engine';
import type { NodeType, WorkflowEdge } from './workflow-engine';
import type { StudioImage, BatchOutput } from './shared-flow';

export const STYLE_OPTIONS = {
  background: { original: '원본 유지', white: '흰색 스튜디오', charcoal: '차콜 스튜디오', sand: '따뜻한 베이지' },
  lighting: { original: '원본 유지', soft: '부드러운 스튜디오', daylight: '자연광', rim: '윤곽 조명' },
  tone: { original: '원본 유지', neutral: '중립적인 색감', warm: '따뜻한 색감', cool: '차분한 색감' },
  ratio: { original: '원본 비율', square: '1:1 정사각형', portrait: '4:5 세로', story: '9:16 세로', landscape: '16:9 가로' },
} as const;
export type CommonStyle = { [K in keyof typeof STYLE_OPTIONS]: keyof typeof STYLE_OPTIONS[K] };
export const DEFAULT_STYLE: CommonStyle = { background: 'original', lighting: 'original', tone: 'original', ratio: 'original' };
export function parseStyle(value: unknown): CommonStyle {
  if (!value || typeof value !== 'object') throw new Error('공통 스타일 설정을 읽지 못했어요.');
  const result = { ...DEFAULT_STYLE };
  for (const key of Object.keys(STYLE_OPTIONS) as (keyof CommonStyle)[]) {
    const option = Reflect.get(value, key);
    if (typeof option !== 'string' || !Object.hasOwn(STYLE_OPTIONS[key], option)) throw new Error('공통 스타일 설정이 올바르지 않아요.');
  }
  return Object.assign(result, { background: Reflect.get(value, 'background'), lighting: Reflect.get(value, 'lighting'), tone: Reflect.get(value, 'tone'), ratio: Reflect.get(value, 'ratio') });
}
export function stylePrompt(style: CommonStyle): string {
  return `공통 스타일: 배경 ${STYLE_OPTIONS.background[style.background]}, 조명 ${STYLE_OPTIONS.lighting[style.lighting]}, 색감 ${STYLE_OPTIONS.tone[style.tone]}, 구도 비율 ${STYLE_OPTIONS.ratio[style.ratio]}. Preserve the original product identity, shape, colors, labels and fine details. Apply the same visual direction to each product. Do not add text or watermarks.`;
}
export function styleTargetIds(nodes: readonly { id: number; type: NodeType; commonStyle?: CommonStyle }[], edges: readonly WorkflowEdge[]): Set<number> {
  const styles = new Set(nodes.filter(node => node.commonStyle).map(node => node.id));
  const operations = nodes.filter(node => ['generate', 'edit', 'blend', 'upscale', 'repeat'].includes(node.type));
  return new Set(operations.filter(node => !styles.size || edges.some(edge => styles.has(edge.source) && edge.target === node.id)).map(node => node.id));
}
export function transparentOperationIds(nodes: readonly { id: number; type: NodeType; prompt?: string }[], edges: readonly WorkflowEdge[]): Set<number> {
  const transparent = new Map<number, boolean>(), operations = new Set<number>();
  for (const node of orderWorkflow(nodes, edges)) {
    const inherited = edges.filter(edge => edge.target === node.id).some(edge => transparent.get(edge.source));
    const tokens = ['prompt', 'command'].includes(node.type) ? node.prompt?.split(/\s+/) || [] : [];
    const active = tokens.includes('/REMOVEBG') || (inherited && !tokens.includes('/NEWBG'));
    transparent.set(node.id, active);
    if (active && ['generate', 'edit', 'blend', 'upscale', 'repeat'].includes(node.type)) operations.add(node.id);
  }
  return operations;
}
export const VISUAL_TASKS = [
  { id: 'cutout', title: '배경 제거', description: '피사체를 남기고 투명 PNG로', prompt: '/REMOVEBG Preserve the original subject, shape, labels and fine edges. Remove only the background and return transparent PNG.', visual: 'cutout' },
  { id: 'background', title: '배경 변경', description: '제품은 유지하고 배경을 교체', prompt: '/NEWBG Preserve the original product identity, shape, colors and labels. Place it in a clean warm beige studio background unless a connected common style specifies a different background. Do not add text.', visual: 'background' },
  { id: 'advertising', title: '광고 연출', description: '제품 중심의 조명과 광고 구도', prompt: '/LUXURY /STUDIO Preserve the original product identity, shape, colors and labels. Create a premium product advertisement with carefully directed lighting and composition. Do not add text or watermarks.', visual: 'advertising' },
] as const;
export type VisualTaskId = typeof VISUAL_TASKS[number]['id'];
export function buildTaskFlow(images: readonly StudioImage[], taskId: VisualTaskId, base: number, groupId: string, y: number) {
  if (images.length > 12 || new Set(images.map(image => image.id)).size !== images.length) throw new Error('한 작업에는 서로 다른 이미지 12장까지 사용할 수 있어요.');
  const task = VISUAL_TASKS.find(task => task.id === taskId);
  if (!task) throw new Error('작업 종류를 확인해 주세요.');
  const nodes = [
    { id: base, type: 'image' as const, x: 70, y, groupId, images: [...images], batchOutput: 'each' as const, imageUrl: images[0]?.url, imageName: `${images.length}장 입력` },
    { id: base + 1, type: 'command' as const, x: 360, y, groupId, prompt: task.prompt },
    { id: base + 2, type: 'edit' as const, x: 600, y, groupId },
    { id: base + 3, type: 'preview' as const, x: 840, y, groupId },
  ];
  return { nodes, edges: [{ id: base + 4, source: base, target: base + 1 }, { id: base + 5, source: base + 1, target: base + 2 }, { id: base + 6, source: base + 2, target: base + 3 }] };
}
type TemplateNode = { id: number; type: NodeType; x: number; y: number; prompt?: string; images?: readonly StudioImage[]; batchOutput?: BatchOutput; commonStyle?: CommonStyle; taskTitle?: string; taskDetail?: string };
export type WorkflowTemplate = { id: string; name: string; nodes: TemplateNode[]; edges: { source: number; target: number }[]; request: string; favorite?: boolean };
export const TEMPLATE_STORAGE_KEY = 'frameflow-templates-v1';
export function makeTemplate(id: string, name: string, nodes: readonly TemplateNode[], edges: readonly WorkflowEdge[], request: string): WorkflowTemplate {
  if (!name.trim() || name.length > 100 || !nodes.length || nodes.length > 500 || request.length > 16000) throw new Error('템플릿 이름과 작업 구조를 확인해 주세요.');
  orderWorkflow(nodes, edges);
  return { id, name: name.trim(), request, nodes: nodes.map(node => ({ ...(node.taskTitle ? { taskTitle: node.taskTitle, taskDetail: node.taskDetail } : {}), id: node.id, type: node.type, x: node.x, y: node.y, ...(node.prompt === undefined ? {} : { prompt: node.prompt }), ...(node.type === 'image' && node.images !== undefined ? { images: [] } : {}), ...(node.batchOutput ? { batchOutput: node.batchOutput } : {}), ...(node.commonStyle ? { commonStyle: parseStyle(node.commonStyle) } : {}) })), edges: edges.map(edge => ({ source: edge.source, target: edge.target })) };
}
export function parseTemplates(value: unknown): WorkflowTemplate[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error('저장된 템플릿을 읽지 못했어요.');
  const ids = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id || raw.id.length > 100 || ids.has(raw.id) || typeof raw.name !== 'string' || typeof raw.request !== 'string' || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges) || raw.edges.length > 2000) throw new Error('저장된 템플릿을 읽지 못했어요.');
    ids.add(raw.id);
    const nodes: TemplateNode[] = raw.nodes.map((node: unknown) => {
      if (!node || typeof node !== 'object' || !('id' in node) || typeof node.id !== 'number' || !Number.isSafeInteger(node.id) || !('x' in node) || typeof node.x !== 'number' || !Number.isFinite(node.x) || !('y' in node) || typeof node.y !== 'number' || !Number.isFinite(node.y) || !('type' in node)) throw new Error('템플릿 노드를 읽지 못했어요.');
      const type = node.type;
      if (type !== 'image' && type !== 'prompt' && type !== 'command' && type !== 'generate' && type !== 'edit' && type !== 'blend' && type !== 'upscale' && type !== 'repeat' && type !== 'preview') throw new Error('템플릿 도구를 읽지 못했어요.');
      if ('commonStyle' in node && type !== 'prompt') throw new Error('공통 스타일은 프롬프트 노드에 저장해 주세요.');
      if ('prompt' in node && (typeof node.prompt !== 'string' || node.prompt.length > 16000)) throw new Error('템플릿 설명을 읽지 못했어요.');
      if ('batchOutput' in node && node.batchOutput !== 'each' && node.batchOutput !== 'sheet') throw new Error('템플릿 출력 방식을 읽지 못했어요.');
      if ('taskTitle' in node && (typeof node.taskTitle !== 'string' || node.taskTitle.length > 60)) throw new Error('작업 이름을 읽지 못했어요.');
      if ('taskDetail' in node && (typeof node.taskDetail !== 'string' || node.taskDetail.length > 300)) throw new Error('작업 설명을 읽지 못했어요.');
      return { ...('taskTitle' in node && typeof node.taskTitle === 'string' ? { taskTitle: node.taskTitle } : {}), ...('taskDetail' in node && typeof node.taskDetail === 'string' ? { taskDetail: node.taskDetail } : {}), id: node.id, type, x: node.x, y: node.y, ...('prompt' in node && typeof node.prompt === 'string' ? { prompt: node.prompt } : {}), ...('images' in node ? { images: [] } : {}), ...('batchOutput' in node ? { batchOutput: node.batchOutput } : {}), ...('commonStyle' in node ? { commonStyle: parseStyle(node.commonStyle) } : {}) };
    });
    const edges = raw.edges.map((edge: unknown) => {
      if (!edge || typeof edge !== 'object' || !('source' in edge) || !('target' in edge) || typeof edge.source !== 'number' || typeof edge.target !== 'number') throw new Error('템플릿 연결을 읽지 못했어요.');
      return { source: edge.source, target: edge.target };
    });
    if (raw.favorite !== undefined && typeof raw.favorite !== 'boolean') throw new Error('템플릿 즐겨찾기를 읽지 못했어요.');
    return { ...makeTemplate(raw.id, raw.name, nodes, edges, raw.request), favorite: raw.favorite === true };
  });
}
export function instantiateTemplate(template: WorkflowTemplate, base: number, groupId: string, y: number) {
  const minY = Math.min(...template.nodes.map(node => node.y));
  const minX = Math.min(...template.nodes.map(node => node.x));
  const ids = new Map(template.nodes.map((node, index) => [node.id, base + index]));
  const nodes = template.nodes.map((node, index) => ({ ...node, id: base + index, x: node.x - minX + 70, y: node.y - minY + y, groupId }));
  const edges = template.edges.map((edge, index) => ({ id: base + nodes.length + index, source: ids.get(edge.source)!, target: ids.get(edge.target)! }));
  const hasInstruction = (id: number): boolean => template.edges.filter(edge => edge.target === id).some(edge => {
    const parent = template.nodes.find(node => node.id === edge.source);
    if (!parent || (parent.type !== 'prompt' && parent.type !== 'command')) return false;
    return Boolean(!parent.commonStyle && parent.prompt?.trim()) || hasInstruction(edge.source);
  });
  const targets = template.nodes.filter(node => ['generate', 'edit', 'blend', 'upscale', 'repeat'].includes(node.type) && !hasInstruction(node.id));
  if (template.request.trim() && targets.length) {
    const id = base + nodes.length + edges.length;
    nodes.push({ id, type: 'prompt', prompt: template.request, x: 70, y: Math.max(...nodes.map(node => node.y)) + 260, groupId });
    targets.forEach((node, index) => edges.push({ id: id + index + 1, source: id, target: ids.get(node.id)! }));
  }
  return { nodes, edges };
}
