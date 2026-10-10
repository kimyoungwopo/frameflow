const test = require('node:test');
const assert = require('node:assert/strict');
require('./load-ts.cjs');
const { validatePlan } = require('../bridge/planner-contract');
const { planningSources, planningPrompt, materializePlan } = require('../web/app/workflow-plan.ts');
const { sharedJobs } = require('../web/app/shared-flow.ts');
const { executeWorkflow } = require('../web/app/workflow-engine.ts');
const { makeTemplate, parseTemplates, instantiateTemplate, styleTargetIds, transparentOperationIds } = require('../web/app/workflow-tools.ts');
const { parseProjectBackup } = require('../web/app/project-backup.ts');
const photos = [{ id:'one', name:'제품 1.png', url:'data:image/png;base64,YQ==' }, { id:'two', name:'제품 2.png', url:'data:image/png;base64,Yg==' }];
const node = (id, type, prompt=null, extra={}) => ({ id, type, prompt, taskTitle:`세부 작업 ${id}`, taskDetail:`${id}번 단계의 구체적인 작업 설명`, inputMode:null, imageIndex:null, commonStyle:null, ...extra });
function batchPlan() {
  return { summary:'각 사진의 배경을 제거한 뒤 베이지 배경으로 변경해 개별 결과를 묶습니다.', warnings:[], nodes:[node(1,'image',null,{inputMode:'each'}),node(2,'command','/REMOVEBG 제품과 라벨 유지'),node(3,'edit'),node(4,'command','/NEWBG 베이지 스튜디오 배경으로 변경. 제품과 라벨 유지'),node(5,'edit'),node(6,'preview')], edges:[{source:1,target:2},{source:2,target:3},{source:3,target:4},{source:4,target:5},{source:5,target:6}] };
}
const response = value => ({ ...validatePlan(value), mode:'gpt' });
const placement = {base:100,groupId:'new',y:700};

test('detailed shared plan executes each stage separately for each photo and clears transparency for new background', async () => {
  // Given
  const built=materializePlan(response(batchPlan()),photos,placement), requests=[];
  // When
  const jobs=await sharedJobs([built.nodes],built.edges,'');
  for(const job of jobs) await executeWorkflow({nodes:job.nodes,edges:built.edges,request:'',normalizeImage:async image=>image,execute:async stage=>{requests.push(stage);return photos[0].url;}});
  // Then
  assert.equal(built.nodes.filter(node=>node.type==='image').length,1);
  assert.equal(built.nodes.filter(node=>node.type==='preview').length,1);
  assert.equal(built.requests,4);assert.equal(jobs.length,2);
  assert.deepEqual(requests.map(stage=>stage.background),['transparent',undefined,'transparent',undefined]);
  assert.deepEqual([requests[0].imageUrls,requests[2].imageUrls],photos.map(photo=>[photo.url]));
  assert.ok(requests[1].prompt.includes('베이지'));
  assert.ok(built.nodes.every(node=>node.taskDetail&&node.groupId==='new'));
});

test('composition binds distinct indexed inputs and performs one operation', async () => {
  // Given
  const plan={summary:'두 제품을 한 장으로 합성',warnings:[],nodes:[node(1,'image',null,{inputMode:'single',imageIndex:0}),node(2,'image',null,{inputMode:'single',imageIndex:1}),node(3,'prompt','두 제품을 같은 장면에 배치'),node(4,'blend'),node(5,'preview')],edges:[{source:1,target:4},{source:2,target:4},{source:3,target:4},{source:4,target:5}]};
  const built=materializePlan(response(plan),photos,placement),requests=[];
  // When
  await executeWorkflow({nodes:built.nodes,edges:built.edges,request:'',normalizeImage:async image=>image,execute:async stage=>{requests.push(stage);return photos[0].url;}});
  // Then
  assert.equal(built.requests,1);assert.equal(requests.length,1);assert.deepEqual(requests[0].imageUrls,photos.map(photo=>photo.url));
  assert.ok(built.nodes.every(node=>node.images===undefined));
});

test('common style is added to every connected operation without replacing operation instructions', async () => {
  // Given
  const plan=batchPlan();plan.nodes.push(node(7,'prompt','부드러운 조명, 따뜻한 색감, 4:5 구도',{commonStyle:{background:'original',lighting:'soft',tone:'warm',ratio:'portrait'}}));plan.edges.push({source:7,target:3},{source:7,target:5});
  const built=materializePlan(response(plan),photos.slice(0,1),placement),requests=[];
  // When
  const [job]=await sharedJobs([built.nodes],built.edges,'');
  await executeWorkflow({nodes:job.nodes,edges:built.edges,request:'',normalizeImage:async image=>image,execute:async stage=>{requests.push(stage);return photos[0].url;}});
  // Then
  assert.ok(requests.every(stage=>stage.prompt.includes('4:5')));assert.ok(requests[0].prompt.includes('/REMOVEBG'));assert.ok(requests[1].prompt.includes('/NEWBG'));
});

test('planner rejects mixed batch/reference inputs and invalid detail or binding metadata', () => {
  // Given
  const mixed=batchPlan();mixed.nodes.push(node(7,'image',null,{inputMode:'single',imageIndex:1}));mixed.edges.push({source:7,target:3});
  const misplaced=batchPlan();misplaced.nodes[2].inputMode='each';
  const oversized=batchPlan();oversized.nodes[0].taskTitle='x'.repeat(61);
  const index=batchPlan();index.nodes[0].inputMode='single';index.nodes[0].imageIndex=99;
  // When / Then
  for(const plan of [mixed,misplaced,oversized,index]) assert.throws(()=>validatePlan(plan),/provider_plan_invalid/);
});

test('input context contains names and indices but no source bytes and refuses missing bindings', () => {
  // Given
  const sources=planningSources([{id:1,type:'image',images:photos}]);
  const single=batchPlan();single.nodes[0].inputMode='single';single.nodes[0].imageIndex=1;
  // When
  const prompt=planningPrompt('각각 누끼', {images:sources,scope:'선택 그룹'});
  // Then
  assert.ok(!prompt.includes('base64'));assert.deepEqual(JSON.parse(prompt).context.images.map(image=>image.index),[0,1]);
  assert.throws(()=>materializePlan(response(single),photos.slice(0,1),placement),/입력 사진/);
  assert.equal(materializePlan(response(batchPlan()),[],placement).missing,true);
});

test('detailed labels survive backups and reusable templates with empty multi-upload inputs', () => {
  // Given
  const built=materializePlan(response(batchPlan()),photos,placement);
  const template=makeTemplate('template','세부 누끼',built.nodes,built.edges,'');
  // When
  const restored=instantiateTemplate(parseTemplates([template])[0],500,'again',900);
  const backup=parseProjectBackup({format:'gpt-node-studio',version:1,projectName:'test',...built,groups:[{id:'new',name:'new'}],history:[],request:'',imageUrl:'',imageName:''});
  // Then
  assert.equal(restored.nodes[0].images.length,0);assert.equal(restored.nodes[2].taskDetail,built.nodes[2].taskDetail);assert.equal(backup.nodes[0].taskTitle,built.nodes[0].taskTitle);
  assert.ok(!JSON.stringify(template).includes('base64'));
});
test('changing a planned style preserves downstream-only targets and isolates the transparent cutout', () => {
  // Given
  const plan=batchPlan();plan.nodes.push(node(7,'prompt','베이지 스타일',{commonStyle:{background:'sand',lighting:'original',tone:'original',ratio:'original'}}));plan.edges.push({source:7,target:5});
  const graph=validatePlan(plan);
  // When
  const targets=styleTargetIds(graph.nodes,graph.edges),transparent=transparentOperationIds(graph.nodes,graph.edges);
  // Then
  assert.deepEqual([...targets],[5]);assert.deepEqual([...transparent],[3]);assert.ok([...targets].every(id=>!transparent.has(id)));
});
