import type { ImageResult } from './result-folders';

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function safeArchiveName(name: string) {
  return name.replace(/[\\/<>:"|?*\x00-\x1f]/g, '-').replace(/^\.+|\.+$/g, '').trim().slice(0,100) || '작업 결과';
}
export function resultZip(images: readonly ImageResult[], folderName: string): Uint8Array<ArrayBuffer> {
  if (!images.length || images.length > 100) throw new Error('ZIP에 넣을 이미지를 1~100장 선택해 주세요.');
  const local: Uint8Array[] = [], directory: Uint8Array[] = [];
  let offset = 0, directorySize = 0, dataSize = 0;
  const encoder = new TextEncoder();
  for (const [index, image] of images.entries()) {
    const match = image.url.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) throw new Error('이미지 파일을 읽지 못했어요. 결과를 다시 확인해 주세요.');
    if (dataSize + match[2].length * .75 > 128 * 1024 * 1024) throw new Error('선택한 이미지가 너무 커요. 128MB 이하로 나누어 다운로드해 주세요.');
    const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
    dataSize += bytes.length;
    const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
    const filename = encoder.encode(`${safeArchiveName(folderName)}/${String(index + 1).padStart(3,'0')}-${safeArchiveName(image.name.replace(/\.(png|jpe?g|webp).*$/i,''))}.${extension}`);
    const checksum = crc32(bytes);
    const header = new Uint8Array(30 + filename.length), view = new DataView(header.buffer);
    view.setUint32(0,0x04034b50,true); view.setUint16(4,20,true); view.setUint16(6,0x800,true); view.setUint16(12,33,true);
    view.setUint32(14,checksum,true); view.setUint32(18,bytes.length,true); view.setUint32(22,bytes.length,true); view.setUint16(26,filename.length,true); header.set(filename,30);
    local.push(header, bytes);
    const central = new Uint8Array(46 + filename.length), centralView = new DataView(central.buffer);
    centralView.setUint32(0,0x02014b50,true); centralView.setUint16(4,20,true); centralView.setUint16(6,20,true); centralView.setUint16(8,0x800,true); centralView.setUint16(14,33,true);
    centralView.setUint32(16,checksum,true); centralView.setUint32(20,bytes.length,true); centralView.setUint32(24,bytes.length,true); centralView.setUint16(28,filename.length,true); centralView.setUint32(42,offset,true); central.set(filename,46);
    directory.push(central); directorySize += central.length; offset += header.length + bytes.length;
  }
  const end = new Uint8Array(22), endView = new DataView(end.buffer);
  endView.setUint32(0,0x06054b50,true); endView.setUint16(8,images.length,true); endView.setUint16(10,images.length,true); endView.setUint32(12,directorySize,true); endView.setUint32(16,offset,true);
  const output = new Uint8Array(offset + directorySize + end.length);
  let cursor = 0;
  for (const chunk of [...local,...directory,end]) { output.set(chunk,cursor); cursor += chunk.length; }
  return output;
}
