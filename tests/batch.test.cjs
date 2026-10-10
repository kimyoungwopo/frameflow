const test = require('node:test');
const assert = require('node:assert/strict');
require('./load-ts.cjs');
const { runBatch } = require('../web/app/batch-runner.ts');
const { buildCutoutBatch, expandedGroupIds, groupBounds } = require('../web/app/studio-groups.ts');
const { executeWorkflow, workflowGroups } = require('../web/app/workflow-engine.ts');
const { parseProjectBackup } = require('../web/app/project-backup.ts');
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('batch holds at two in-flight chains and starts queued work only when a slot opens', async () => {
  const gates = [defer(), defer(), defer()]; const started = []; let active = 0; let peak = 0;
  const run = runBatch({ items: [0,1,2], controller: new AbortController(), concurrency: 20, isFatal: () => false, execute: async index => { started.push(index); peak = Math.max(peak, ++active); await gates[index].promise; active--; } });
  assert.deepEqual(started, [0,1]); gates[1].resolve(); await new Promise(setImmediate); assert.deepEqual(started, [0,1,2]); gates[0].resolve(); gates[2].resolve();
  const outcomes = await run; assert.equal(peak,2); assert.deepEqual(outcomes.map(x=>x.status),['done','done','done']);
});
test('ordinary image failure preserves successes and allows remaining photos to finish', async () => {
  const outcomes = await runBatch({items:[0,1,2],controller:new AbortController(),concurrency:2,isFatal:()=>false,execute:async index=>{if(index===1) throw new Error('bad photo');}});
  assert.deepEqual(outcomes.map(x=>x.status),['done','error','done']); assert.equal(outcomes[1].message,'bad photo');
});
test('cancellation waits for in-flight work and never starts queued photos', async () => {
  const controller = new AbortController(); const gates=[defer(),defer()]; const started=[]; let settled=false;
  const run=runBatch({items:[0,1,2,3],controller,concurrency:2,isFatal:()=>false,execute:async index=>{started.push(index);await gates[index].promise;}}).finally(()=>{settled=true;});
  const rejected=assert.rejects(run,/abort/i); controller.abort(); await new Promise(setImmediate); assert.equal(settled,false); gates.forEach(g=>g.resolve()); await rejected; assert.deepEqual(started,[0,1]);
});
test('fatal authentication failure aborts peer requests and prevents queued work', async () => {
  const controller=new AbortController(); const started=[];
  const run=runBatch({items:[0,1,2],controller,concurrency:2,isFatal:error=>error.message==='auth',execute:async index=>{started.push(index);if(index===0)throw new Error('auth');await new Promise(resolve=>controller.signal.addEventListener('abort',resolve,{once:true}));}});
  await assert.rejects(run,/auth/); assert.equal(controller.signal.aborted,true); assert.deepEqual(started,[0,1]);
});
test('cutout batch keeps every source isolated and requests true transparency', async () => {
  const batch=buildCutoutBatch([{url:'image-A',name:'A.png'},{url:'image-B',name:'B.png'}],100,'batch',150);
  const chains=workflowGroups(batch.nodes,batch.edges,null);assert.equal(chains.length,2);const calls=[];const previews=[];
  for(const chain of chains) await executeWorkflow({nodes:chain,edges:batch.edges.filter(e=>chain.some(n=>n.id===e.source)),request:'',normalizeImage:async x=>x,execute:async stage=>{calls.push(stage);return `cutout-${calls.length}`;},onPreview:(node,image)=>previews.push(image)});
  assert.deepEqual(calls.map(x=>x.imageUrls),[['image-A'],['image-B']]); assert.ok(calls.every(x=>x.background==='transparent')); assert.deepEqual(previews,['cutout-1','cutout-2']);
  assert.equal(expandedGroupIds(batch.nodes,batch.edges,[102]).size,4); assert.throws(()=>buildCutoutBatch(Array(13).fill({url:'x',name:'x'}),1,'g',0));
});
test('group metadata survives portable backup and rejects dangling membership', () => {
  const graph=buildCutoutBatch([{url:'data:image/png;base64,YQ==',name:'A.png'}],1,'g',150);
  const backup={format:'gpt-node-studio',version:1,projectName:'batch',request:'',imageUrl:'',imageName:'',history:[],...graph,groups:[{id:'g',name:'누끼'}]};
  const result=parseProjectBackup(JSON.parse(JSON.stringify(backup)));assert.equal(result.groups[0].name,'누끼');assert.ok(result.nodes.every(n=>n.groupId==='g'));assert.throws(()=>parseProjectBackup({...backup,groups:[{id:'other',name:'Other'}]}));
  const bounds=groupBounds(result.nodes);assert.ok(bounds.x<result.nodes[0].x);assert.ok(bounds.width>=960);
  assert.throws(()=>parseProjectBackup({...backup,groups:undefined}));
  assert.throws(()=>parseProjectBackup({...backup,nodes:backup.nodes.map((node,index)=>index===0?{...node,groupId:undefined}:node)}));
});
