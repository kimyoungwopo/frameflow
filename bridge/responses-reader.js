function failure(code = 'provider_plan_invalid', planReason = 'response_format') { return Object.assign(new Error(code), { status: 502, planReason }); }
function responseText(response) {
  const output = response?.output;
  if (!Array.isArray(output)) throw failure('provider_plan_invalid', 'response_output');
  const contents = output.filter(item => item.type === 'message').flatMap(item => Array.isArray(item.content) ? item.content : []);
  if (contents.some(item => item.type === 'refusal')) throw failure('provider_plan_refused');
  const text = contents.filter(item => item.type === 'output_text').map(item => item.text).join('');
  if (!text || text.length > 256 * 1024) throw failure('provider_plan_invalid', !text ? 'response_text' : 'response_text_size');
  return text;
}
async function readResponse(response) {
  if (!response.body) throw failure('provider_plan_invalid', 'response_body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const streaming = !(response.headers.get('content-type') || '').includes('application/json');
  const outputItems = new Map();
  let buffer = '', size = 0, completed = null;
  const event = frame => {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let value; try { value = JSON.parse(data); } catch { throw failure('provider_plan_invalid', 'stream_event_json'); }
    if (['error', 'response.failed', 'response.incomplete'].includes(value.type)) throw failure('provider_plan_failed');
    if (value.type === 'response.output_item.done' && value.item?.type === 'message') outputItems.set(value.output_index, value.item);
    if (value.type === 'response.completed') {
      if (value.response?.status !== 'completed') throw failure('provider_plan_invalid', 'response_status');
      completed = { ...value.response, output: value.response.output?.length ? value.response.output : [...outputItems.values()] };
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { buffer += decoder.decode(); break; }
      size += value.byteLength;
      if (size > 8 * 1024 * 1024) throw failure('provider_plan_invalid', 'stream_size');
      buffer += decoder.decode(value, { stream: true });
      if (streaming) {
        const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop(); frames.forEach(event);
        if (completed) break;
      }
    }
    if (streaming) { if (buffer.trim()) event(buffer); if (!completed) throw failure('provider_plan_invalid', 'response_incomplete'); }
    else { try { completed = JSON.parse(buffer); } catch { throw failure('provider_plan_invalid', 'response_envelope_json'); } if (completed.status !== 'completed') throw failure('provider_plan_invalid', 'response_status'); }
    const text = responseText(completed);
    try { return JSON.parse(text); } catch { throw failure('provider_plan_invalid', 'response_json'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
module.exports = { readResponse };
