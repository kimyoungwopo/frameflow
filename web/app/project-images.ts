import type { StudioImage } from './shared-flow';

type ImageNode = { readonly id: number; readonly imageUrl?: string; readonly images?: readonly StudioImage[] };
export function imageRecordKeys(nodes: readonly ImageNode[]) {
  return nodes.flatMap(node => [`node:${node.id}`, ...(node.images || []).map(image => `node:${node.id}:image:${image.id}`)]);
}
export function nodeImageRecords(nodes: readonly ImageNode[]) {
  return nodes.flatMap(node => [...(node.imageUrl ? [{ key: `node:${node.id}`, url: node.imageUrl }] : []), ...(node.images || []).filter(image => image.url).map(image => ({ key: `node:${node.id}:image:${image.id}`, url: image.url }))]);
}
export function imageMetadata<T extends ImageNode>(nodes: readonly T[]) {
  return nodes.map(({ imageUrl: _imageUrl, ...node }) => ({ ...node, ...(node.images ? { images: node.images.map(image => ({ ...image, url: '' })) } : {}) }));
}
export function restoreNodeImages<T extends ImageNode>(nodes: readonly T[], records: Readonly<Record<string,string>>) {
  return nodes.map(node => ({ ...node, imageUrl: records[`node:${node.id}`] || node.imageUrl, ...(node.images ? { images: node.images.map(image => ({ ...image, url: records[`node:${node.id}:image:${image.id}`] || image.url })) } : {}) }));
}
