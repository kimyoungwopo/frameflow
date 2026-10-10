const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePlan } = require('../bridge/planner-contract');
const { readResponse } = require('../bridge/responses-reader');
const valid = () => ({ summary: 'A workflow', warnings: [], nodes: [{ id: 1, type: 'prompt', prompt: 'Draw a cat' }, { id: 2, type: 'generate', prompt: null }, { id: 3, type: 'preview', prompt: null }], edges: [{ source: 1, target: 2 }, { source: 2, target: 3 }] });
const completed = value => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
test('validated GPT graph gets deterministic distinct coordinates', () => {
  // Given / When
  const result = validatePlan(valid());
  // Then
  assert.equal(result.nodes.length, 3); assert.equal(result.edges.length, 2);
  assert.equal(new Set(result.nodes.map(n => `${n.x},${n.y}`)).size, 3);
  assert.ok(result.nodes[1].x > result.nodes[0].x);
});
test('invalid GPT graph is rejected without dropping nodes or edges', () => {
  // Given
  const cases = [];
  const unknown = valid(); unknown.nodes[1].type = 'shell'; cases.push(unknown);
  const duplicate = valid(); duplicate.nodes[1].id = 1; cases.push(duplicate);
  const dangling = valid(); dangling.edges[0].target = 99; cases.push(dangling);
  const cycle = valid(); cycle.edges.push({ source: 2, target: 1 }); cases.push(cycle);
  const duplicateEdge = valid(); duplicateEdge.edges.push({ source: 1, target: 2 }); cases.push(duplicateEdge);
  const empty = valid(); empty.nodes = []; cases.push(empty);
  const missingInstruction = valid(); missingInstruction.nodes[0].type = 'image'; missingInstruction.nodes[1].type = 'edit'; cases.push(missingInstruction);
  const missingPreview = valid(); missingPreview.nodes.pop(); missingPreview.edges.pop(); cases.push(missingPreview);
  const repeat = valid(); repeat.nodes[1].type = 'repeat'; repeat.nodes[1].prompt = 'REPEAT:99'; cases.push(repeat);
  // When / Then
  for (const value of cases) assert.throws(() => validatePlan(value), { message: 'provider_plan_invalid' });
});
test('SSE parser handles UTF-8 and split frames and waits for completion', async () => {
  // Given
  const value = valid(); value.summary = '이미지 생성';
  const wire = `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '{}' })}\r\n\r\ndata: ${JSON.stringify({ type: 'response.completed', response: completed(value) })}\r\n\r\n`;
  const bytes = new TextEncoder().encode(wire);
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } });
  // When
  const result = await readResponse(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
  // Then
  assert.deepEqual(result, value);
});
test('partial, failed and refused Responses are not treated as plans', async () => {
  // Given
  const values = [
    'data: {"type":"response.output_text.delta","delta":"{}"}\n\n',
    'data: {"type":"response.failed","response":{"error":{"code":"usage_limit"}}}\n\n',
    'data: {"type":"response.incomplete"}\n\n',
    `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] } })}\n\n`,
  ];
  // When / Then
  for (const wire of values) await assert.rejects(readResponse(new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } })));
});
test('oversized Responses stream is stopped before parsing', async () => {
  // Given
  const response = new Response('x'.repeat(8 * 1024 * 1024 + 1));
  // When / Then
  await assert.rejects(readResponse(response), { message: 'provider_plan_invalid', planReason: 'stream_size' });
});
test('valid workflow survives a Responses stream with large reasoning metadata', async()=>{
  const value=valid(),reasoning={type:'reasoning',encrypted_content:'x'.repeat(600*1024)};
  const terminal={...completed(value),output:[reasoning,...completed(value).output]};
  const wire=`data: ${JSON.stringify({type:'response.output_item.done',output_index:0,item:reasoning})}\n\ndata: ${JSON.stringify({type:'response.completed',response:terminal})}\n\n`;
  assert.ok(Buffer.byteLength(wire)>1024*1024);
  const result=await readResponse(new Response(wire,{headers:{'Content-Type':'text/event-stream'}}));
  assert.deepEqual(result,value);assert.equal(validatePlan(result).nodes.length,3);
});
test('large stream allowance still rejects oversized final workflow text',async()=>{
  const terminal=completed(valid());terminal.output[0].content[0].text='x'.repeat(256*1024+1);
  const response=new Response(JSON.stringify(terminal),{headers:{'Content-Type':'application/json'}});
  await assert.rejects(readResponse(response),{message:'provider_plan_invalid',planReason:'response_text_size'});
});
test('Codex stream without Content-Type uses completed output items before its empty terminal output', async () => {
  // Given
  const value = valid();
  const wire = `data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: completed(value).output[0] })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [] } })}\n\n`;
  const response = new Response(new TextEncoder().encode(wire));
  // When / Then
  assert.deepEqual(await readResponse(response), value);
});
