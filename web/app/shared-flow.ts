import { estimateRequests, validateWorkflow, WorkflowExecutionError } from './workflow-engine';
import type { WorkflowNode, WorkflowEdge } from './workflow-engine';

export type StudioImage = { readonly id: string; readonly name: string; readonly url: string };
export type BatchOutput = 'each' | 'sheet';
export type SharedNode = WorkflowNode & { readonly images?: readonly StudioImage[]; readonly batchOutput?: BatchOutput; readonly batchSignature?: string };
export type SharedJob<T extends SharedNode> = { readonly id: number | string; readonly name: string; readonly nodes: readonly T[]; readonly inputId?: number; readonly source?: StudioImage; readonly output?: BatchOutput; readonly signature?: string };

export async function sharedJobs<T extends SharedNode>(chains: readonly (readonly T[])[], edges: readonly WorkflowEdge[], request: string): Promise<SharedJob<T>[]> {
  const jobs: SharedJob<T>[] = [];
  for (const chain of chains) {
    const roots = chain.filter(node => node.type === 'image' && node.images?.length);
    if (roots.length > 1) throw new WorkflowExecutionError('공통 플로우에는 여러 사진 입력을 하나만 연결해 주세요.');
    const root = roots[0];
    if (!root?.images?.length) { jobs.push({ id: chain[0].id, name: `워크플로우 ${chain[0].id}`, nodes: chain }); continue; }
    if (root.images.length > 12 || new Set(root.images.map(image => image.id)).size !== root.images.length) throw new WorkflowExecutionError('입력 사진은 중복 ID 없이 12장까지 사용할 수 있어요.');
    if (!chain.some(node => ['edit', 'upscale', 'repeat', 'blend', 'motion'].includes(node.type))) throw new WorkflowExecutionError('여러 사진 입력에는 이미지 처리 노드를 연결해 주세요.');
    const scopedEdges = edges.filter(edge => chain.some(node => node.id === edge.source) && chain.some(node => node.id === edge.target));
    const payload = JSON.stringify({ request, edges: scopedEdges.map(edge => [edge.source,edge.target]), nodes: chain.map(node => ({ id: node.id, type: node.type, prompt: node.prompt, commonStyle: node.commonStyle, imageUrl: node.type === 'image' ? node.imageUrl : undefined, images: node.type === 'image' ? node.images : undefined })) });
    const bytes = new TextEncoder().encode(payload);
    const signature = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    for (const source of root.images) {
      const nodes = chain.map(node => node.id === root.id ? { ...node, imageUrl: source.url, images: undefined } : node);
      validateWorkflow(nodes, scopedEdges, request);
      jobs.push({ id: `${root.id}:${source.id}`, name: source.name, nodes, source, inputId: root.id, output: root.batchOutput || 'each', signature });
    }
  }
  return jobs;
}

export function estimateSharedRequests(nodes: readonly SharedNode[]): number {
  const count = nodes.find(node => node.type === 'image' && node.images?.length)?.images?.length || 1;
  return estimateRequests(nodes) * count;
}

export function sheetLayout(count: number, side = 2048) {
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new WorkflowExecutionError('한 장으로 모을 이미지는 1~12장이어야 해요.');
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const cell = Math.floor(side / columns);
  const padding = Math.round(cell * .06);
  return { width: columns * cell, height: rows * cell, cells: Array.from({ length: count }, (_, index) => ({ x: (index % columns) * cell + padding, y: Math.floor(index / columns) * cell + padding, width: cell - padding * 2, height: cell - padding * 2 })) };
}

export async function composeSheet(urls: readonly string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const layout = sheetLayout(urls.length);
  const canvas = document.createElement('canvas'); canvas.width = layout.width; canvas.height = layout.height;
  const context = canvas.getContext('2d');
  if (!context) throw new WorkflowExecutionError('이미지를 한 장으로 모을 수 없는 브라우저예요.');
  for (let index = 0; index < urls.length; index++) {
    signal.throwIfAborted();
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const item = new Image();
      const clean = () => signal.removeEventListener('abort', abort);
      const abort = () => { item.onload = null; item.onerror = null; item.src = ''; clean(); reject(new DOMException('Cancelled', 'AbortError')); };
      item.onload = () => { clean(); resolve(item); }; item.onerror = () => { clean(); reject(new WorkflowExecutionError('누끼 결과를 읽지 못했어요.')); };
      signal.addEventListener('abort', abort, { once: true }); item.src = urls[index];
    });
    signal.throwIfAborted();
    const cell = layout.cells[index];
    const scale = Math.min(cell.width / image.naturalWidth, cell.height / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    context.drawImage(image, cell.x + (cell.width - width) / 2, cell.y + (cell.height - height) / 2, width, height);
  }
  signal.throwIfAborted();
  return canvas.toDataURL('image/png');
}
