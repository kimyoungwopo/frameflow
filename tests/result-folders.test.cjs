const test = require('node:test');
const assert = require('node:assert/strict');
require('./load-ts.cjs');
const { resultUnits, addResult, retainResults, imageDownloadName } = require('../web/app/result-folders.ts');
const { parseProjectBackup } = require('../web/app/project-backup.ts');
const folder = (id) => ({id,name:`Folder ${id}`,expectedCount:2});
const image = (id,group,order,url=`url-${id}`) => ({id,name:`${id}.png`,url,createdAt:'2026-10-07T01:00:00Z',folder:group,resultKey:id,resultOrder:order});

test('folder lists contain complete individual outputs in input order, not completion order', () => {
  const f=folder('one');const units=resultUnits([image('B',f,1),image('A',f,0)]);assert.equal(units.length,1);assert.equal(units[0].folder.id,'one');assert.deepEqual(units[0].images.map(image=>image.name),['A.png','B.png']);
});
test('same-folder retry updates an existing file while identical pixels in another run remain separate', () => {
  const f=folder('one');const first=image('A',f,0);const retry={...first,id:'new-id',url:'updated'};const next=addResult([first],retry,60);assert.equal(next.length,1);assert.equal(next[0].id,'A');assert.equal(next[0].url,'updated');
  const other=addResult(next,image('new-run',folder('two'),0,'updated'),60);assert.equal(resultUnits(other).length,2);
});
test('cached legacy files move into a folder without duplicating the flat result', () => {
  const old={id:'legacy',name:'A.png',url:'same',createdAt:'2026-10-07T01:00:00Z'};const next=addResult([old],image('A',folder('one'),0,'same'),60);assert.equal(next.length,1);assert.equal(next[0].folder.id,'one');assert.equal(next[0].url,'same');
});
test('history retention removes old folders as a unit rather than half their photos', () => {
  const recent=folder('new'),old=folder('old');const result=retainResults([image('A',recent,0),image('B',recent,1),image('C',old,0),image('D',old,1)],3);assert.equal(result.length,2);assert.equal(resultUnits(result).length,1);
});
test('folder metadata and preview collection survive a portable backup', () => {
  const f=folder('one');const value={format:'gpt-node-studio',version:1,projectName:'Folder test',request:'',imageUrl:'',imageName:'',groups:[],edges:[],nodes:[{id:1,type:'preview',x:0,y:0,resultFolder:f,previewMode:'each'}],history:[image('A',f,0,'data:image/png;base64,YQ==')]};
  const backup=parseProjectBackup(JSON.parse(JSON.stringify(value)));assert.deepEqual(backup.history[0].folder,f);assert.equal(backup.history[0].resultOrder,0);assert.deepEqual(backup.nodes[0].resultFolder,f);assert.equal(backup.nodes[0].previewMode,'each');
  assert.throws(()=>parseProjectBackup({...value,history:[{...value.history[0],folder:{...f,expectedCount:0}}]}));assert.throws(()=>parseProjectBackup({...value,history:[value.history[0],value.history[0]]}));
});
test('individual PNG download names preserve the original photo basename', () => {
  assert.equal(imageDownloadName('제품 사진.jpg'),'제품 사진-result.png');assert.equal(imageDownloadName('../photo.webp'),'photo-result.png');assert.equal(imageDownloadName('photo.png · 결과'),'photo-result.png');
});
