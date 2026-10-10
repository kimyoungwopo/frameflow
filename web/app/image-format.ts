export function imageOutputFormat(source: Blob | string): 'image/png' | 'image/jpeg' {
  const mime = typeof source === 'string' ? source.match(/^data:([^;,]+)/)?.[1] : source.type;
  return mime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
}
