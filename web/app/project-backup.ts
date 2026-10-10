import { parseStyle } from './workflow-tools';
import type { CommonStyle } from './workflow-tools';
import { orderWorkflow } from './workflow-engine';
import type { NodeType } from './workflow-engine';
import type { ResultFolder } from './result-folders';
import type { StudioImage, BatchOutput } from './shared-flow';
import { parseGroups, HISTORY_LIMIT } from './studio-groups';

type BackupNode = { readonly id: number; readonly type: NodeType; readonly x: number; readonly y: number; readonly prompt?: string; readonly imageUrl?: string; readonly imageName?: string; readonly groupId?: string; readonly images?: readonly StudioImage[]; readonly batchOutput?: BatchOutput; readonly batchSignature?: string; readonly resultFolder?: ResultFolder; readonly commonStyle?: CommonStyle; readonly previewMode?: BatchOutput; readonly taskTitle?: string; readonly taskDetail?: string };
type BackupEdge = { readonly id: number; readonly source: number; readonly target: number };
type BackupHistory = { readonly id: string; readonly name: string; readonly createdAt: string; readonly url: string; readonly folder?: ResultFolder; readonly resultKey?: string; readonly resultOrder?: number };
class BackupError extends Error { constructor() { super('유효한 Studio 프로젝트 백업 파일이 아니에요.'); } }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BackupError();
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown, limit = 16000): string {
  if (typeof value !== 'string' || value.length > limit) throw new BackupError();
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new BackupError();
  return value;
}
function image(value: unknown): string {
  const url = text(value, 32 * 1024 * 1024);
  if (url && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(url)) throw new BackupError();
  return url;
}
function nodeType(value: unknown): NodeType {
  switch (value) {
    case 'prompt': case 'generate': case 'command': case 'image': case 'edit': case 'blend': case 'upscale': case 'repeat': case 'motion': case 'preview': return value;
    default: throw new BackupError();
  }
}
function imageList(value: unknown): StudioImage[] {
  if (!Array.isArray(value) || value.length > 12) throw new BackupError();
  const ids = new Set<string>();
  return value.map(raw => { const item = object(raw); const id = text(item.id, 100); if (!id || ids.has(id)) throw new BackupError(); ids.add(id); return { id, name: text(item.name, 1000), url: image(item.url) }; });
}
function batchOutput(value: unknown): BatchOutput {
  if (value !== 'each' && value !== 'sheet') throw new BackupError();
  return value;
}
function batchSignature(value: unknown): string {
  const signature = text(value, 64); if (!/^[a-f0-9]{64}$/.test(signature)) throw new BackupError(); return signature;
}
function resultFolder(value: unknown): ResultFolder {
  const folder = object(value);
  const id = text(folder.id, 200), name = text(folder.name, 200), expectedCount = number(folder.expectedCount);
  if (!id || !name.trim() || !Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 10000) throw new BackupError();
  return { id, name, expectedCount };
}
function resultOrder(value: unknown): number {
  const order = number(value); if (!Number.isInteger(order) || order < 0 || order > 10000) throw new BackupError(); return order;
}
export function parseProjectBackup(value: unknown) {
  const data = object(value);
  if (data.format !== 'gpt-node-studio' || data.version !== 1 || !Array.isArray(data.nodes) || !Array.isArray(data.edges) || !Array.isArray(data.history) || data.nodes.length > 500 || data.edges.length > 2000 || data.history.length > HISTORY_LIMIT) throw new BackupError();
  const nodes: BackupNode[] = data.nodes.map((raw) => {
    const node = object(raw);
    if (node.commonStyle !== undefined && node.type !== 'prompt') throw new BackupError();
    return { ...(node.taskTitle === undefined ? {} : { taskTitle: text(node.taskTitle, 60) }), ...(node.taskDetail === undefined ? {} : { taskDetail: text(node.taskDetail, 300) }), id: number(node.id), type: nodeType(node.type), x: number(node.x), y: number(node.y), ...(node.resultFolder === undefined ? {} : { resultFolder: resultFolder(node.resultFolder) }), ...(node.previewMode === undefined ? {} : { previewMode: batchOutput(node.previewMode) }), ...(node.images === undefined ? {} : { images: imageList(node.images) }), ...(node.batchOutput === undefined ? {} : { batchOutput: batchOutput(node.batchOutput) }), ...(node.batchSignature === undefined ? {} : { batchSignature: batchSignature(node.batchSignature) }), ...(node.commonStyle === undefined ? {} : { commonStyle: parseStyle(node.commonStyle) }), ...(node.prompt === undefined ? {} : { prompt: text(node.prompt) }), ...(node.imageUrl === undefined ? {} : { imageUrl: image(node.imageUrl) }), ...(node.groupId === undefined ? {} : { groupId: text(node.groupId, 100) }), ...(node.imageName === undefined ? {} : { imageName: text(node.imageName, 1000) }) };
  });
  const edges: BackupEdge[] = data.edges.map((raw) => { const edge = object(raw); return { id: number(edge.id), source: number(edge.source), target: number(edge.target) }; });
  orderWorkflow(nodes, edges);
  if (new Set(edges.map((edge) => edge.id)).size !== edges.length) throw new BackupError();
  const history: BackupHistory[] = data.history.map((raw) => { const entry = object(raw); return { id: text(entry.id, 1000), name: text(entry.name, 1000), createdAt: text(entry.createdAt, 1000), url: image(entry.url), ...(entry.folder === undefined ? {} : { folder: resultFolder(entry.folder) }), ...(entry.resultKey === undefined ? {} : { resultKey: text(entry.resultKey, 200) }), ...(entry.resultOrder === undefined ? {} : { resultOrder: resultOrder(entry.resultOrder) }) }; });
  if (new Set(history.map(entry => entry.id)).size !== history.length) throw new BackupError();
  return { projectName: text(data.projectName, 1000), nodes, groups: parseGroups(data.groups, nodes, edges), edges, history, request: text(data.request), imageUrl: image(data.imageUrl), imageName: text(data.imageName, 1000) };
}
