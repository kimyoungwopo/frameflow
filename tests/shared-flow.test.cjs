const test = require('node:test');
const assert = require('node:assert/strict');
require('./load-ts.cjs');
const { sharedJobs, estimateSharedRequests, sheetLayout, composeSheet } = require('../web/app/shared-flow.ts');
const { buildSharedCutout } = require('../web/app/studio-groups.ts');
const { imageMetadata, nodeImageRecords, imageRecordKeys, restoreNodeImages } = require('../web/app/project-images.ts');
const { parseProjectBackup } = require('../web/app/project-backup.ts');
const images = [{id:'A',name:'A.png',url:'data:image/png;base64,YQ=='},{id:'B',name:'B.png',url:'data:image/png;base64,Yg=='}];
const graph = () => buildSharedCutout(images,100,'group',150);

test('twelve photos use only four shared nodes and each execution receives its own source', async () => {
  const g=graph();assert.equal(g.nodes.length,4);assert.equal(g.edges.length,3);assert.equal(g.nodes[0].images.length,2);
  const jobs=await sharedJobs([g.nodes],g.edges,'');assert.deepEqual(jobs.map(job=>job.id),['100:A','100:B']);assert.deepEqual(jobs.map(job=>job.nodes[0].imageUrl),images.map(image=>image.url));assert.ok(jobs.every(job=>job.nodes[0].images===undefined));assert.equal(jobs[0].signature,jobs[1].signature);assert.equal(estimateSharedRequests(g.nodes),2);
  const twelve=buildSharedCutout(Array.from({length:12},(_,i)=>({...images[0],id:String(i)})),200,'g',150);assert.equal(twelve.nodes.length,4);assert.equal(estimateSharedRequests(twelve.nodes),12);
});
test('photo task IDs remain unique when backups reuse photo IDs in different shared inputs', async () => {
  const a=graph(),b=buildSharedCutout(images,200,'other',150);const jobs=await sharedJobs([a.nodes,b.nodes],[...a.edges,...b.edges],'');assert.equal(new Set(jobs.map(job=>job.id)).size,4);
});
test('cached results remain valid across layout and output-mode changes but not source or prompt changes', async () => {
  const g=graph();const signature=(await sharedJobs([g.nodes],g.edges,''))[0].signature;
  const moved=g.nodes.map(node=>({...node,x:node.x+80,batchOutput:'each'}));assert.equal((await sharedJobs([moved],g.edges,''))[0].signature,signature);
  const changed=g.nodes.map(node=>node.type==='command'?{...node,prompt:node.prompt+' preserve logo'}:node);assert.notEqual((await sharedJobs([changed],g.edges,''))[0].signature,signature);
  const source=g.nodes.map(node=>node.type==='image'?{...node,images:[{...images[0],url:images[1].url},images[1]]}:node);assert.notEqual((await sharedJobs([source],g.edges,''))[0].signature,signature);
});
test('batch images live in image records rather than oversized localStorage metadata', () => {
  const g=graph();const metadata=imageMetadata(g.nodes);assert.equal(metadata[0].imageUrl,undefined);assert.equal(metadata[0].images[0].url,'');
  const records=Object.fromEntries(nodeImageRecords(g.nodes).map(record=>[record.key,record.url]));const restored=restoreNodeImages(metadata,records);assert.deepEqual(restored[0].images,images);assert.equal(restored[0].imageUrl,images[0].url);assert.equal(imageRecordKeys(g.nodes).length,6);
});
test('portable backup validates embedded batch images, IDs and result mode', () => {
  const g=graph();const backup={format:'gpt-node-studio',version:1,projectName:'Shared',request:'',imageUrl:'',imageName:'',history:[],...g,groups:[{id:'group',name:'Shared'}]};
  assert.deepEqual(parseProjectBackup(backup).nodes[0].images,images);
  const badUrl={...backup,nodes:g.nodes.map(node=>node.type==='image'?{...node,images:[{...images[0],url:'https://evil.invalid/image.png'}]}:node)};assert.throws(()=>parseProjectBackup(badUrl));
  assert.throws(()=>parseProjectBackup({...backup,nodes:g.nodes.map(node=>node.type==='image'?{...node,images:[images[0],images[0]]}:node)}));
  assert.throws(()=>parseProjectBackup({...backup,nodes:g.nodes.map(node=>({...node,batchOutput:'unknown'}))}));
});
test('contact sheet uses a transparent canvas and centers images without stretching or another AI call', async () => {
  const priorDocument=global.document,priorImage=global.Image;const draws=[];let canvas;
  global.Image=class {naturalWidth=400;naturalHeight=200;set src(value){queueMicrotask(()=>this.onload?.());}};
  global.document={createElement:()=>{canvas={width:0,height:0,getContext:()=>({drawImage:(...args)=>draws.push(args.slice(1))}),toDataURL:type=>{assert.equal(type,'image/png');return 'data:image/png;base64,YQ==';}};return canvas;}};
  try {assert.equal(await composeSheet(['A','B'],new AbortController().signal),'data:image/png;base64,YQ==');assert.equal(canvas.width,2048);assert.equal(canvas.height,1024);assert.equal(draws.length,2);assert.equal(draws[0][2]/draws[0][3],2);assert.ok(draws[1][0]>draws[0][0]);} finally {global.document=priorDocument;global.Image=priorImage;}
  assert.throws(()=>sheetLayout(0));assert.throws(()=>sheetLayout(13));assert.equal(sheetLayout(12).cells.length,12);
});
