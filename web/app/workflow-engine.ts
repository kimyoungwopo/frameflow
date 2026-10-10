import type { CommonStyle } from './workflow-tools';
import { commandInstructions } from './command-instructions';

export type NodeType = 'prompt' | 'generate' | 'command' | 'image' | 'edit' | 'blend' | 'upscale' | 'repeat' | 'motion' | 'preview';
export type WorkflowNode = {
  readonly id: number;
  readonly type: NodeType;
  readonly prompt?: string;
  readonly taskDetail?: string;
  readonly imageUrl?: string;
  readonly commonStyle?: CommonStyle;
};
export type WorkflowEdge = { readonly source: number; readonly target: number };
export type StageRequest = {
  readonly kind: 'generate' | 'edit';
  readonly prompt: string;
  readonly imageUrls: readonly string[];
  readonly background?: 'transparent';
};
export type AnimationEncoder = (frames: readonly string[], fps: number) => Promise<string>;
export type AnimationAtlasSplitter = (atlas: string, frameCount: number) => Promise<readonly string[]>;
type NodeOutput = {
  readonly images: readonly string[];
  readonly instructions: readonly string[];
  readonly background?: 'transparent' | null;
  readonly styles?: readonly string[];
};
export class WorkflowExecutionError extends Error {
  constructor(message: string, readonly code = 'workflow_invalid') {
    super(message);
    this.name = 'WorkflowExecutionError';
  }
}
const fail = (message: string): never => { throw new WorkflowExecutionError(message); };
const assertNever = (value: never): never => { throw new WorkflowExecutionError(`알 수 없는 노드: ${String(value)}`); };

const motionPoseInstruction = (frame: number, total: number) => {
  const normalized = total <= 4 ? frame : Math.round((frame - 1) * 3 / Math.max(1, total - 1));
  if (normalized <= 0) return 'Use a calm neutral standing pose with the character fully settled.';
  if (normalized === 1) return 'Use a small anticipation pose: lower the body slightly and prepare the legs without changing the position.';
  if (normalized === 2) return 'Use a gentle airborne pose: lift the body slightly with small readable limb changes while staying centered.';
  return 'Use a gentle landing pose that is close to the neutral pose and ready to transition back smoothly.';
};

const refineMotionPrompt = (text: string, frame: number, total: number) => `${text.trim()}. Create one clean pose from a short looping 2D pixel animation. ${motionPoseInstruction(frame, total)} Return exactly one full-canvas frame image containing one character only. never a sprite sheet, contact sheet, collage, tiled grid, storyboard, multiple poses, ghost trails, duplicate body parts, frame numbers, labels, captions, UI, watermark, logo or any other text inside the image. Do not place one pose on top of another or redraw the character with geometric/vector shapes. Preserve the original raster pixel clusters, facial features, ear pixels, paw pixels, palette and outline exactly; change only the requested pose pixels. Do not repaint the whole face or body. Preserve the exact same character, silhouette, palette, camera, canvas size, anchor point and transparent background. Change only the requested pose with hard pixel edges, no blur, no interpolation and no anti-aliasing. Keep the character centered and fully inside the canvas so this image can be used as one animation frame.`;
const refineMotionAtlasPrompt = (text: string, total: number) => `${text.trim()}. Create exactly one horizontal pixel-animation atlas for ONE motion only, containing exactly ${total} equal-width frames in a single low-height row. The returned atlas must be exactly 1024x256 pixels for ${total} === 4, so its width is exactly divisible by the frame count; do not return a square canvas or any other width. Each cell must be exactly 256 pixels wide. Prefer a wide atlas with each cell having generous transparent left and right breathing room; never let a neighboring pose enter a cell. Use the visual language of a small hand-authored game sprite: a simple 32x32 or 64x64 logical pixel design enlarged without smoothing, with chunky readable pixel clusters, a bold clear silhouette, and a restrained palette of about 6 to 8 solid colors. Do not turn the character into a detailed illustration, painterly image, realistic fur, soft shading, or high-resolution vector-like artwork. Each cell must contain one complete full-canvas pose of the same simple pixel character, with transparent gutters or transparent cell background. This is an intermediate atlas for Frameflow to crop; do not add labels, numbers, frame indexes, captions, UI, watermark, logo or text. Do not put multiple poses inside one cell, do not overlap cells, do not create a contact sheet or multiple rows. Preserve the canonical raster pixel clusters, face layout, exactly two eyes, readable front paws and legs, limited palette, dark outline, silhouette, camera, scale and anchor. Keep the head, eyes, paws and tail visually legible at the final small display size. Use hard pixel edges, nearest-neighbor pixel construction, no blur, interpolation, anti-aliasing, gradients or semi-transparent painted edges. The named motion must read through a small pose change, not a camera move or a large redraw, and must return cleanly to the first cell.`;

function motionSetting(text: string, token: 'frames' | 'fps', fallback: number) {
  const pattern = token === 'frames' ? /(?:FRAMES|FRAME)\s*:\s*(\d+)|(\d+)\s*프레임/i : /FPS\s*:\s*(\d+)|(\d+)\s*FPS/i;
  const match = text.match(pattern);
  return Number(match?.[1] || match?.[2] || fallback);
}

export function orderWorkflow(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[]): WorkflowNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length) fail('노드 ID가 중복돼요. 작업 순서를 다시 구성해 주세요.');
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<number, number[]>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) fail('존재하지 않는 노드를 가리키는 연결선이 있어요.');
    if (edge.source === edge.target) fail('같은 노드에 연결할 수 없어요.');
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
  }
  const queue = nodes.filter((node) => incoming.get(node.id) === 0);
  const ordered: WorkflowNode[] = [];
  while (queue.length) {
    const node = queue.shift();
    if (!node) break;
    ordered.push(node);
    for (const id of outgoing.get(node.id) || []) {
      const count = (incoming.get(id) || 0) - 1;
      incoming.set(id, count);
      const next = byId.get(id);
      if (count === 0 && next) queue.push(next);
    }
  }
  if (ordered.length !== nodes.length) fail('워크플로우에 순환 연결이 있어 실행할 수 없어요.');
  return ordered;
}

export function workflowGroups(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], selected: number | readonly number[] | null) {
  const selectedIds = selected === null ? null : new Set(typeof selected === 'number' ? [selected] : selected);
  if (selectedIds === null) orderWorkflow(nodes, edges);
  const remaining = new Set(nodes.map((node) => node.id));
  const groups: WorkflowNode[][] = [];
  for (const node of nodes) {
    if (!remaining.has(node.id)) continue;
    const ids = new Set([node.id]);
    const queue = [node.id];
    while (queue.length) {
      const current = queue.shift();
      for (const edge of edges) {
        const next = edge.source === current ? edge.target : edge.target === current ? edge.source : undefined;
        if (next !== undefined && !ids.has(next)) { ids.add(next); queue.push(next); }
      }
    }
    for (const id of ids) remaining.delete(id);
    if (selectedIds === null || [...selectedIds].some(id => ids.has(id))) {
      const group = nodes.filter((item) => ids.has(item.id));
      if (selectedIds !== null) orderWorkflow(group, edges.filter(edge => ids.has(edge.source) || ids.has(edge.target)));
      groups.push(group);
    }
  }
  return groups;
}

export function validateWorkflow(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], request: string) {
  const ordered = orderWorkflow(nodes, edges);
  if (!nodes.some((node) => node.type === 'preview')) fail('실행 결과를 확인할 PREVIEW 노드를 추가해 주세요.');
  const available = new Map<number, ReadonlySet<number>>();
  const instructions = new Map<number, boolean>();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of ordered) {
    const parents = edges.filter((edge) => edge.target === node.id).map((edge) => edge.source);
    const inherited = new Set(parents.flatMap((id) => [...(available.get(id) || [])]));
    const count = inherited.size;
    const hasInstruction = parents.some((id) => instructions.get(id)) || Boolean((node.type === 'prompt' || node.type === 'command' || node.type === 'edit') && node.prompt?.trim());
    if (node.type === 'image' && !node.imageUrl) fail('IMAGE INPUT에 이미지를 넣어 주세요.');
    if (node.type === 'image' && parents.length) fail('IMAGE INPUT은 입력 노드예요. 다른 노드의 출력을 연결할 수 없어요.');
    if (node.type === 'preview' && (!parents.length || !count)) fail('PREVIEW에 이미지 결과를 연결해 주세요.');
    if (node.type === 'preview' && count > 1) fail('PREVIEW에는 이미지 결과 하나만 연결해 주세요. 여러 이미지는 BLEND로 합칠 수 있어요.');
    if (node.type === 'preview' && edges.some((edge) => edge.source === node.id)) fail('PREVIEW는 마지막 결과 노드예요.');
    if (['edit', 'upscale', 'repeat', 'motion'].includes(node.type) && count === 0) fail(`${node.type.toUpperCase()}에 입력 이미지를 연결해 주세요.`);
    if (node.type === 'blend' && count < 2) fail('BLEND에는 연결된 입력 이미지가 2개 이상 필요해요.');
    if ((node.type === 'generate' || node.type === 'edit') && !request.trim() && !hasInstruction) fail('작업 노드에 PROMPT를 연결하거나 작업 설명을 입력해 주세요.');
    if (parents.some((id) => byId.get(id)?.type === 'preview')) fail('PREVIEW 뒤에는 작업을 연결할 수 없어요.');
    const operation = ['generate', 'edit', 'blend', 'upscale', 'repeat', 'motion'].includes(node.type);
    available.set(node.id, node.type === 'image' || operation ? new Set([node.id]) : inherited);
    instructions.set(node.id, operation || node.type === 'image' ? false : hasInstruction);
  }
}

type ExecutionOptions = {
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
  readonly request: string;
  readonly execute: (stage: StageRequest) => Promise<string>;
  readonly normalizeImage: (image: string) => Promise<string>;
  readonly onNodeStart?: (node: WorkflowNode) => void;
  readonly onPreview?: (node: WorkflowNode, image: string) => void;
  readonly encodeAnimation?: AnimationEncoder;
  readonly encodeApng?: AnimationEncoder;
  readonly splitMotionAtlas?: AnimationAtlasSplitter;
};

export async function executeWorkflow(options: ExecutionOptions): Promise<ReadonlyMap<number, NodeOutput>> {
  const { nodes, edges, request, execute, normalizeImage, onNodeStart, onPreview } = options;
  validateWorkflow(nodes, edges, request);
  const outputs = new Map<number, NodeOutput>();
  for (const node of orderWorkflow(nodes, edges)) {
    const inputs = edges.filter((edge) => edge.target === node.id).flatMap((edge) => {
      const output = outputs.get(edge.source);
      return output ? [output] : [];
    });
    const images = [...new Set(inputs.flatMap((input) => input.images))];
    const instructions = [...new Set(inputs.flatMap((input) => input.instructions))];
    const styles = [...new Set(inputs.flatMap(input => input.styles || []))];
    const editPrompt = node.type === 'edit' ? node.prompt?.trim() || '' : '';
    const editCommands = editPrompt.split(/\s+/);
    // A null background is an explicit NEWBG reset, consumed by the next image operation.
    const background: NodeOutput['background'] = editCommands.includes('/REMOVEBG') ? 'transparent' : editCommands.includes('/NEWBG') ? null : inputs.some(input => input.background === null) ? null : inputs.some(input => input.background === 'transparent') ? 'transparent' : undefined;
    const inherited: NodeOutput = { images, instructions, background, styles };
    const stage = async (kind: StageRequest['kind'], prompt: string, imageUrls: readonly string[]): Promise<NodeOutput> => {
      onNodeStart?.(node);
      const result = await execute({ kind, prompt, imageUrls, background: background ?? undefined });
      if (!result) throw new WorkflowExecutionError('provider가 결과 이미지를 반환하지 않았어요.', 'provider_result_invalid');
      return { images: [result], instructions: [], background: background ?? undefined };
    };
    const prompt = [instructions.join('. ') || (editPrompt ? '' : request.trim()), editPrompt, ...styles].filter(Boolean).join('. ');
    switch (node.type) {
      case 'image': {
        if (!node.imageUrl) fail('IMAGE INPUT에 이미지를 넣어 주세요.');
        outputs.set(node.id, { images: [await normalizeImage(node.imageUrl)], instructions: [] });
        break;
      }
      case 'prompt':
      case 'command': {
        const text = node.prompt?.trim() || '';
        const own = node.type === 'command' ? commandInstructions(text) : text;
        const cutout = own.split(/\s+/).includes('/REMOVEBG');
        const newBackground = own.split(/\s+/).includes('/NEWBG');
        outputs.set(node.id, { ...inherited, styles: [...styles, ...(node.commonStyle && own ? [own] : [])], instructions: [...instructions, ...(!node.commonStyle && own ? [own] : []), ...(cutout ? ['Remove the background and preserve the subject. Return a true transparent alpha background.'] : [])], background: cutout ? 'transparent' : newBackground ? null : background });
        break;
      }
      case 'generate':
        if (!prompt) fail('이미지 설명을 입력해 주세요.');
        outputs.set(node.id, await stage('generate', prompt, []));
        break;
      case 'edit':
        if (!prompt) fail('이미지 편집 내용을 입력해 주세요.');
        outputs.set(node.id, await stage('edit', prompt, images));
        break;
      case 'blend':
        if (images.length < 2) fail('BLEND에는 서로 다른 입력 이미지가 2개 이상 필요해요.');
        outputs.set(node.id, await stage('edit', `${prompt} Combine the input images into one coherent image while preserving important subjects.`, images));
        break;
      case 'upscale':
        outputs.set(node.id, await stage('edit', `${prompt} Upscale the input image, preserve details and improve resolution and sharpness.`, images));
        break;
      case 'repeat': {
        const count = Math.min(5, Math.max(2, Number(node.prompt?.match(/REPEAT:(\d+)/i)?.[1] || 2)));
        let result: NodeOutput = inherited;
        for (let index = 0; index < count; index += 1) result = await stage('edit', `${prompt} Refine the current image while preserving the subject. Improvement pass ${index + 1} of ${count}.`, result.images);
        outputs.set(node.id, result);
        break;
      }
      case 'motion': {
        if (!options.encodeAnimation) fail('스프라이트 모션 인코더가 준비되지 않았어요.');
        if (!options.splitMotionAtlas) fail('모션 atlas 분리기가 준비되지 않았어요.');
        const motionText = [node.prompt, node.taskDetail].filter(Boolean).join(' ');
        const frameCount = Math.min(12, Math.max(4, motionSetting(motionText, 'frames', 8)));
        const fps = Math.min(24, Math.max(4, motionSetting(motionText, 'fps', 6)));
        const atlas = await stage('edit', refineMotionAtlasPrompt(prompt || '단순한 픽셀 캐릭터의 자연스러운 단일 모션', frameCount), images);
        const frames = await options.splitMotionAtlas(atlas.images[0], frameCount);
        if (frames.length !== frameCount) fail(`모션 atlas에서 ${frameCount}개 프레임을 분리하지 못했어요.`);
        const wantsApng = /(?:FORMAT|OUTPUT):APNG/i.test(motionText);
        const encoder = wantsApng ? options.encodeApng : options.encodeAnimation;
        if (!encoder) fail(wantsApng ? 'APNG 인코더가 준비되지 않았어요.' : '스프라이트 모션 인코더가 준비되지 않았어요.');
        outputs.set(node.id, { images: [await encoder(frames, fps)], instructions: [] });
        break;
      }
      case 'preview': {
        const image = images[0];
        if (!image || images.length !== 1) fail('PREVIEW에 이미지 결과 하나를 연결해 주세요.');
        outputs.set(node.id, inherited);
        onPreview?.(node, image);
        break;
      }
      default: assertNever(node.type);
    }
  }
  return outputs;
}

export function estimateRequests(nodes: readonly WorkflowNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.type === 'repeat') return total + Math.min(5, Math.max(2, Number(node.prompt?.match(/REPEAT:(\d+)/i)?.[1] || 2)));
    if (node.type === 'motion') {
      const motionText = [node.prompt, node.taskDetail].filter(Boolean).join(' ');
      return total + Math.min(12, Math.max(4, motionSetting(motionText, 'frames', 8)));
    }
    return total + (['generate', 'edit', 'blend', 'upscale'].includes(node.type) ? 1 : 0);
  }, 0);
}
