const test = require('node:test');
const assert = require('node:assert/strict');
require('./load-ts.cjs');
const { buildTaskFlow } = require('../web/app/workflow-tools.ts');
const { snapshotFlow, snapshotMatches, editingPrompt, prepareFlowEdit, replaceFlow } = require('../web/app/workflow-edit.ts');
const { validatePlan } = require('../bridge/planner-contract');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../web/node_modules/typescript');
const photos=[{id:'one',name:'제품1.png',url:'data:image/png;base64,YQ=='},{id:'two',name:'제품2.png',url:'data:image/png;base64,Yg=='}];
function original() {
  const a=buildTaskFlow(photos,'background',100,'a',150),b=buildTaskFlow(photos.slice(0,1),'cutout',1000,'b',900);
  a.nodes[1]={...a.nodes[1],type:'prompt'};
  a.nodes[3]={...a.nodes[3],imageUrl:photos[0].url,resultFolder:{id:'old-results',name:'기존 결과',expectedCount:2}};
  return {nodes:[...a.nodes,...b.nodes],edges:[...a.edges,...b.edges],request:'원래 작업 지시'};
}
function proposed(snapshot) {
  const types=['image','prompt','edit','prompt','edit','preview'],ids=[100,101,102,1,2,103];
  const nodes=types.map((type,index)=>({id:ids[index],type,prompt:type==='prompt'?(index===1?snapshot.nodes[1].prompt:'부드러운 조명. 제품 보존'):null,taskTitle:`단계 ${index+1}`,taskDetail:`구체적인 설명 ${index+1}`,inputMode:type==='image'?'each':null,imageIndex:null,commonStyle:null}));
  return {...validatePlan({summary:'배경 변경 뒤 조명 편집 추가',warnings:[],nodes,edges:ids.slice(0,-1).map((id,index)=>({source:id,target:ids[index+1]}))}),mode:'gpt'};
}

test('editing context contains the complete selected graph and input indices but excludes pixels and cached results',()=>{
  // Given
  const graph=original(),snapshot=snapshotFlow('project',graph,[100,101,102,103]);
  // When
  const wire=editingPrompt('조명 단계 추가',snapshot,'선택 그룹'),body=JSON.parse(wire);
  // Then
  assert.ok(wire.length<=8000);assert.ok(!wire.includes('base64'));assert.ok(!wire.includes('old-results'));
  assert.deepEqual(body.context.workflow.nodes.map(node=>node.id),[100,101,102,103]);
  assert.deepEqual(body.context.workflow.nodes[0].imageIndices,[0,1]);assert.equal(body.context.workflow.nodes[1].prompt,graph.nodes[1].prompt);
  assert.equal(body.context.workflow.request,'원래 작업 지시');assert.equal(body.request,'조명 단계 추가');
  assert.equal(body.operation,'edit');
  assert.equal(body.context.workflow.nodes[0].inputMode,'each');
});
test('applying an edit preserves input identity, stable IDs, unrelated flows and leaves the original snapshot immutable',()=>{
  // Given
  const graph=original(),snapshot=snapshotFlow('p',graph,[100,101,102,103]),draft=prepareFlowEdit(proposed(snapshot),snapshot,10000);
  // When
  const next=replaceFlow(snapshot,{nodes:draft.nodes,edges:draft.edges,request:graph.request},{projectId:'p',graph});
  // Then
  assert.equal(next.nodes.find(node=>node.id===100).images,graph.nodes[0].images);assert.equal(next.nodes.find(node=>node.id===100).imageUrl,photos[0].url);
  assert.equal(next.nodes.find(node=>node.id===103).imageUrl,undefined);assert.equal(next.nodes.find(node=>node.id===103).resultFolder,undefined);
  assert.ok(graph.nodes[3].resultFolder);assert.equal(draft.requests,4);assert.equal(draft.diff.added,2);assert.equal(draft.diff.removed,0);
  assert.ok(next.nodes.filter(node=>node.groupId==='a').every(node=>node.groupId==='a'));
  assert.equal(next.nodes.find(node=>node.id===1000),graph.nodes.find(node=>node.id===1000));
  assert.equal(next.edges.find(edge=>edge.id===1004),graph.edges.find(edge=>edge.id===1004));
});
test('stale scoped edits and project changes are rejected while unrelated edits can be preserved',()=>{
  // Given
  const graph=original(),snapshot=snapshotFlow('p',graph,[100,101,102,103]),draft=prepareFlowEdit(proposed(snapshot),snapshot,10000);
  const changed={...graph,nodes:graph.nodes.map(node=>node.id===101?{...node,prompt:'사용자가 바꾼 내용'}:node)};
  const outside={...graph,nodes:graph.nodes.map(node=>node.id===1001?{...node,prompt:'다른 작업 수정'}:node)};
  // When / Then
  assert.throws(()=>replaceFlow(snapshot,{nodes:draft.nodes,edges:draft.edges,request:graph.request},{projectId:'p',graph:changed}),/플로우가 변경/);
  assert.equal(snapshotMatches(snapshot,'another',graph),false);
  assert.equal(snapshotMatches(snapshot,'p',{...graph,edges:[...graph.edges,{id:99,source:102,target:1003}]}),false);
  const next=replaceFlow(snapshot,{nodes:draft.nodes,edges:draft.edges,request:graph.request},{projectId:'p',graph:outside});
  assert.equal(next.nodes.find(node=>node.id===1001).prompt,'다른 작업 수정');
});
test('undo restores the original nodes and preview cache without discarding unrelated changes',()=>{
  // Given
  const graph=original(),before=snapshotFlow('p',graph,[100,101,102,103]),draft=prepareFlowEdit(proposed(before),before,10000);
  const applied=replaceFlow(before,{nodes:draft.nodes,edges:draft.edges,request:graph.request},{projectId:'p',graph});
  const after=snapshotFlow('p',applied,draft.nodes.map(node=>node.id));
  const current={...applied,nodes:applied.nodes.map(node=>node.id===1001?{...node,prompt:'후속 외부 수정'}:node)};
  // When
  const undone=replaceFlow(after,before,{projectId:'p',graph:current});
  // Then
  assert.equal(undone.nodes.find(node=>node.id===103),graph.nodes[3]);assert.equal(undone.nodes.find(node=>node.id===100).images,graph.nodes[0].images);
  assert.equal(undone.nodes.find(node=>node.id===1001).prompt,'후속 외부 수정');assert.equal(undone.nodes.length,graph.nodes.length);
});
test('cross-scope dependencies, invalid edits and excessive graph context fail before any mutation',()=>{
  // Given
  const graph=original(),snapshot=snapshotFlow('p',graph,[100,101,102,103]);
  const before=JSON.stringify(graph),invalid=proposed(snapshot);invalid.edges[0].target=99999;
  // When / Then
  assert.throws(()=>snapshotFlow('p',graph,[101,102,103]),/선택 범위 밖/);
  assert.throws(()=>prepareFlowEdit(invalid,snapshot,10000));
  assert.throws(()=>editingPrompt('x'.repeat(4001),snapshot,'test'),/4,000/);
  const huge={...snapshot,nodes:snapshot.nodes.map(node=>node.type==='prompt'?{...node,prompt:'x'.repeat(10000)}:node)};
  assert.throws(()=>editingPrompt('추가',huge,'test'),/작은 그룹/);
  assert.equal(JSON.stringify(graph),before);
});
test('edit review steps follow dependencies when the provider lists the old preview before newly added stages',()=>{
  // Given
  const graph=original(),snapshot=snapshotFlow('p',graph,[100,101,102,103]),value=proposed(snapshot);
  value.nodes=[...value.nodes.slice(0,3),value.nodes[5],value.nodes[3],value.nodes[4]];
  // When
  const draft=prepareFlowEdit(value,snapshot,10000);
  // Then
  assert.equal(draft.nodes.at(-1).type,'preview');assert.deepEqual(draft.nodes.map(node=>node.type),['image','prompt','edit','prompt','edit','preview']);
});
test('removing an existing stage reconnects the retained chain while preserving all input photos',()=>{
  // Given
  const graph=original(),before=snapshotFlow('p',graph,[100,101,102,103]),added=prepareFlowEdit(proposed(before),before,10000);
  const current=replaceFlow(before,{nodes:added.nodes,edges:added.edges,request:graph.request},{projectId:'p',graph});
  const snapshot=snapshotFlow('p',current,added.nodes.map(node=>node.id)),value=proposed(before);
  value.nodes=value.nodes.filter(node=>[100,101,102,103].includes(node.id));value.edges=[{id:1,source:100,target:101},{id:2,source:101,target:102},{id:3,source:102,target:103}];
  // When
  const removed=prepareFlowEdit(value,snapshot,20000),next=replaceFlow(snapshot,{nodes:removed.nodes,edges:removed.edges,request:graph.request},{projectId:'p',graph:current});
  // Then
  assert.equal(removed.diff.removed,2);assert.equal(removed.diff.added,0);assert.equal(removed.requests,2);
  assert.equal(next.nodes.find(node=>node.id===100).images,graph.nodes[0].images);assert.ok(next.edges.some(edge=>edge.source===102&&edge.target===103));
});
function editRequester() {
  const graph=original(),drafts=[],messages=[];let finish,calls=0;
  const source=fs.readFileSync(require.resolve('../web/app/page.tsx'),'utf8');
  const code=source.slice(source.indexOf('  const requestFlowEdit ='),source.indexOf('  const applyFlowEdit ='));
  const context={...graph,currentProjectId:'p',editScope:graph.nodes.filter(node=>node.groupId==='a'),toolScopeName:'group a',uploading:false,editDraft:null,executionRef:{current:null},planningRef:{current:null},AbortController,AbortSignal,snapshotFlow,editingPrompt,prepareFlowEdit,setPlanning(){},setEditing(){},setMessage(message){messages.push(message);},setEditDraft(draft){drafts.push(draft);},startLogin:async()=>{},localBridgeFetch:()=>{calls++;return new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>proposed(snapshotFlow('p',graph,[100,101,102,103]))});});}};
  vm.createContext(context);vm.runInContext(ts.transpile(code+'\nglobalThis.submit=requestFlowEdit;',{target:ts.ScriptTarget.ES2022}),context);
  return {context,graph,drafts,messages,calls:()=>calls,finish:()=>finish()};
}
test('overlapping natural edit submissions produce one review and never mutate the graph before apply',async()=>{
  // Given
  const run=editRequester(),before=JSON.stringify(run.graph),pending=run.context.submit('조명 추가');
  // When
  await run.context.submit('중복 요청');run.finish();await pending;
  // Then
  assert.equal(run.calls(),1);assert.equal(run.drafts.length,1);assert.equal(JSON.stringify(run.graph),before);assert.equal(run.context.planningRef.current,null);
});
test('cancelled edits cannot display a late provider response or change existing nodes',async()=>{
  // Given
  const run=editRequester(),before=JSON.stringify(run.graph),pending=run.context.submit('조명 추가');
  // When
  run.context.planningRef.current.abort();run.finish();await pending;
  // Then
  assert.equal(run.drafts.length,0);assert.equal(JSON.stringify(run.graph),before);assert.ok(run.messages.some(message=>message.includes('취소')));
});
