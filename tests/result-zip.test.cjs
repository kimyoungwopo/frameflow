const test = require('node:test');
const assert = require('node:assert/strict');
require('./load-ts.cjs');
const { resultZip, crc32 } = require('../web/app/result-zip.ts');
const { parseTemplates, makeTemplate } = require('../web/app/workflow-tools.ts');

test('ZIP stores exact image bytes with CRC, Unicode filenames and distinct names', () => {
  const images=[{name:'같은 이름.png',url:'data:image/png;base64,YQ=='},{name:'같은 이름.png',url:'data:image/png;base64,Yg=='}];
  const zip=Buffer.from(resultZip(images,'../제품/결과'));let offset=0;const names=[];
  for(const image of images){assert.equal(zip.readUInt32LE(offset),0x04034b50);assert.equal(zip.readUInt16LE(offset+6),0x800);const len=zip.readUInt16LE(offset+26),size=zip.readUInt32LE(offset+18);names.push(zip.subarray(offset+30,offset+30+len).toString('utf8'));const data=zip.subarray(offset+30+len,offset+30+len+size);assert.deepEqual(data,Buffer.from(image.url.split(',')[1],'base64'));assert.equal(zip.readUInt32LE(offset+14),crc32(data));offset+=30+len+size;}
  assert.equal(new Set(names).size,2);assert.ok(names.every(name=>!name.startsWith('../')&&name.includes('제품-결과/')));assert.equal(zip.readUInt32LE(offset),0x02014b50);assert.equal(zip.readUInt16LE(zip.length-12),2);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
  assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);
});
test('ZIP uses actual file extension and rejects remote URLs and empty selections', () => {
  const bytes=Buffer.from(resultZip([{name:'photo.png',url:'data:image/jpeg;base64,YQ=='}],'Folder'));assert.ok(bytes.includes(Buffer.from('001-photo.jpg')));
  assert.throws(()=>resultZip([], 'Folder'));assert.throws(()=>resultZip([{name:'x',url:'https://example.com/x.png'}],'Folder'));
});
test('template favorites survive parsing and old templates remain compatible', () => {
  const template=makeTemplate('a','Test',[{id:1,type:'image',x:0,y:0}],[],'');
  assert.equal(parseTemplates([template])[0].favorite,false);assert.equal(parseTemplates([{...template,favorite:true}])[0].favorite,true);
  assert.throws(()=>parseTemplates([{...template,favorite:'yes'}]));
});
