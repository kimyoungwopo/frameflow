export type ResultFolder = { readonly id: string; readonly name: string; readonly expectedCount: number };
export type ImageResult = { readonly id: string; readonly name: string; readonly createdAt: string; readonly url: string; readonly projectId?: string; readonly folder?: ResultFolder; readonly resultKey?: string; readonly resultOrder?: number };
export type ResultUnit = { readonly id: string; readonly folder?: ResultFolder; readonly images: readonly ImageResult[] };

export function resultUnits(history: readonly ImageResult[]): ResultUnit[] {
  const units: { id: string; folder?: ResultFolder; images: ImageResult[] }[] = [];
  const grouped = new Map<string, { id: string; folder: ResultFolder; images: ImageResult[] }>();
  for (const image of history) {
    if (!image.folder) { units.push({ id: `image:${image.id}`, images: [image] }); continue; }
    const existing = grouped.get(image.folder.id);
    if (existing) existing.images.push(image);
    else { const unit = { id: image.folder.id, folder: image.folder, images: [image] }; grouped.set(unit.id, unit); units.push(unit); }
  }
  for (const unit of units) if (unit.folder) unit.images.sort((a,b) => (a.resultOrder ?? Number.MAX_SAFE_INTEGER) - (b.resultOrder ?? Number.MAX_SAFE_INTEGER));
  return units;
}

export function retainResults(history: readonly ImageResult[], limit: number): ImageResult[] {
  const kept = new Set<string>(); let count = 0;
  for (const unit of resultUnits(history)) {
    if (count + unit.images.length > limit && count > 0) break;
    for (const image of unit.images.slice(0, limit - count)) { kept.add(image.id); count++; }
  }
  return history.filter(image => kept.has(image.id));
}

export function addResult(history: readonly ImageResult[], entry: ImageResult, limit: number): ImageResult[] {
  const previous = history.find(image => entry.folder ? image.folder?.id === entry.folder.id && (entry.resultKey ? image.resultKey === entry.resultKey : image.url === entry.url) : !image.folder && image.url === entry.url);
  const next = { ...entry, id: previous?.id || entry.id };
  const rest = history.filter(image => image.id !== next.id && !(entry.folder && !image.folder && image.url === entry.url));
  return retainResults([next, ...rest], limit);
}

export function imageDownloadName(name: string) {
  const base = (name.split(/[\\/]/).pop() || 'image').replace(/\.(png|jpe?g|webp).*$/i, '').replace(/[<>:"|?*\x00-\x1f]/g, '-');
  return `${base || 'image'}-result.png`;
}
