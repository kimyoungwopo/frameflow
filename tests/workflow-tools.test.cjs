const test = require('node:test');
const assert = require('node:assert/strict');
require('./load-ts.cjs');
const { buildTaskFlow, makeTemplate, parseTemplates, instantiateTemplate, DEFAULT_STYLE, stylePrompt, parseStyle } = require('../web/app/workflow-tools.ts');
const { sharedJobs } = require('../web/app/shared-flow.ts');
const { executeWorkflow } = require('../web/app/workflow-engine.ts');
const { parseProjectBackup } = require('../web/app/project-backup.ts');
const photos = [{ id:'a',name:'one.png',url:'data:image/png;base64,YQ==' },{ id:'b',name:'two.png',url:'data:image/png;base64,Yg==' }];

test('result folder next tasks keep one shared input and distinct requests without modifying originals', async () => {
  for (const task of ['cutout','background','advertising']) {
    const graph = buildTaskFlow(photos, task, 100, 'next', 150);
    assert.equal(graph.nodes.length,4);assert.equal(graph.nodes[0].batchOutput,'each');
    const jobs = await sharedJobs([graph.nodes],graph.edges,'');const requests=[];
    for (const job of jobs) await executeWorkflow({nodes:job.nodes,edges:graph.edges,request:'',normalizeImage:async x=>x,execute:async stage=>{requests.push(stage);return photos[0].url;}});
    assert.deepEqual(requests.map(request=>request.imageUrls),photos.map(image=>[image.url]));
    assert.ok(requests.every(request=>request.prompt.includes(task==='cutout'?'/REMOVEBG':task==='background'?'/NEWBG':'/LUXURY')));
    assert.equal(requests[0].background,task==='cutout'?'transparent':undefined);
  }
  assert.deepEqual(photos.map(photo=>photo.name),['one.png','two.png']);
  assert.throws(()=>buildTaskFlow(Array.from({length:13},(_,i)=>({...photos[0],id:String(i)})),'cutout',100,'g',0));
});
test('saved templates exclude images, cached results and unrelated metadata and remap IDs when inserted', () => {
  const graph=buildTaskFlow(photos,'background',100,'old',150);
  const template=makeTemplate('template','Reusable',graph.nodes.map(node=>({...node,imageUrl:photos[0].url,resultFolder:{id:'secret'},batchSignature:'cached',credentials:'private',images:node.images})),graph.edges,'request');
  const serialized=JSON.stringify(template);assert.ok(!serialized.includes('base64'));assert.ok(!serialized.includes('private'));assert.ok(!serialized.includes('cached'));assert.ok(!serialized.includes('secret'));
  const clean=parseTemplates([template])[0];assert.equal(clean.nodes[0].images.length,0);
  const next=instantiateTemplate(clean,500,'new',800);assert.equal(next.nodes[0].id,500);assert.equal(next.nodes[0].y,800);assert.equal(next.nodes[0].groupId,'new');assert.equal(next.edges[0].source,500);assert.equal(next.edges[0].target,501);
  assert.throws(()=>parseTemplates([{...template,nodes:[{...template.nodes[0],type:'invalid'}]}]));
  assert.throws(()=>parseTemplates([{...template,edges:[{source:999,target:100}]}]));
});
test('template fallback request is scoped to inserted nodes instead of changing other flows', async () => {
  const source={nodes:[{id:1,type:'image',x:0,y:0},{id:2,type:'edit',x:200,y:0},{id:3,type:'preview',x:400,y:0}],edges:[{source:1,target:2},{source:2,target:3}]};
  const template=makeTemplate('x','Scoped',source.nodes,source.edges,'Replace background with blue');const graph=instantiateTemplate(template,100,'g',150);
  const nodes=graph.nodes.map(node=>node.type==='image'?{...node,imageUrl:photos[0].url}:node);const requests=[];
  await executeWorkflow({nodes,edges:graph.edges,request:'unrelated project instructions',normalizeImage:async x=>x,execute:async stage=>{requests.push(stage);return photos[0].url;}});
  assert.equal(requests[0].prompt,'Replace background with blue');
});
test('common style reaches every image request, changes cache signature and survives template and backup', async () => {
  const style={...DEFAULT_STYLE,background:'white',lighting:'soft',tone:'warm',ratio:'portrait'};
  const graph=buildTaskFlow(photos,'advertising',100,'g',150);
  const original=(await sharedJobs([graph.nodes],graph.edges,''))[0].signature;
  graph.nodes.push({id:200,type:'prompt',x:70,y:450,groupId:'g',commonStyle:style,prompt:stylePrompt(style)});graph.edges.push({id:201,source:200,target:102});
  const jobs=await sharedJobs([graph.nodes],graph.edges,'');assert.notEqual(jobs[0].signature,original);const requests=[];
  for(const job of jobs) await executeWorkflow({nodes:job.nodes,edges:graph.edges,request:'',normalizeImage:async x=>x,execute:async stage=>{requests.push(stage);return photos[0].url;}});
  assert.ok(requests.every(request=>request.prompt.includes('흰색 스튜디오')&&request.prompt.includes('4:5')));
  assert.deepEqual(parseTemplates([makeTemplate('style','Style',graph.nodes,graph.edges,'')])[0].nodes.find(node=>node.commonStyle).commonStyle,style);
  const backup=parseProjectBackup({format:'gpt-node-studio',version:1,projectName:'Style',...graph,groups:[{id:'g',name:'Style'}],history:[],request:'',imageUrl:'',imageName:''});assert.deepEqual(backup.nodes.find(node=>node.commonStyle).commonStyle,style);
  assert.throws(()=>parseStyle({...style,background:'evil'}));
});
test('motion nodes survive planner materialization backup validation', () => {
  const backup=parseProjectBackup({format:'gpt-node-studio',version:1,projectName:'Motion',nodes:[
    {id:1,type:'image',x:0,y:0,imageUrl:photos[0].url},
    {id:2,type:'prompt',x:200,y:0,prompt:'상하 바운스'},
    {id:3,type:'motion',x:400,y:0,prompt:'FRAMES:4 FPS:6'},
    {id:4,type:'preview',x:600,y:0},
  ],edges:[{id:5,source:1,target:2},{id:6,source:2,target:3},{id:7,source:3,target:4}],groups:[],history:[],request:'',imageUrl:'',imageName:''});
  assert.deepEqual(backup.nodes.map(node=>node.type),['image','prompt','motion','preview']);
});
test('common style augments fallback instructions instead of replacing the requested edit', async () => {
  const nodes=[{id:1,type:'image',imageUrl:photos[0].url},{id:2,type:'prompt',commonStyle:DEFAULT_STYLE,prompt:stylePrompt(DEFAULT_STYLE)},{id:3,type:'edit'},{id:4,type:'preview'}];
  const edges=[{source:1,target:3},{source:2,target:3},{source:3,target:4}];const requests=[];
  await executeWorkflow({nodes,edges,request:'Remove the scratch on the cap',normalizeImage:async x=>x,execute:async stage=>{requests.push(stage);return photos[0].url;}});
  assert.ok(requests[0].prompt.includes('Remove the scratch on the cap'));assert.ok(requests[0].prompt.includes('공통 스타일'));
});
