// Isolated lifecycle QA: localhost:4450, no real account or AI provider.
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const imageUrl = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, 'fixtures/transparent.png')).toString('base64')}`;
const jobs = new Map();
const requests = [];
const graph = { mode: 'gpt', name: 'QA 생성', nodes: [{ id: 1, type: 'prompt', x: 70, y: 150, prompt: 'QA picture', taskTitle: '이미지 지시', taskDetail: '검증 이미지 지시' }, { id: 2, type: 'generate', x: 360, y: 150, prompt: null, taskTitle: '이미지 생성', taskDetail: '지연 응답 검증' }, { id: 3, type: 'preview', x: 650, y: 150, prompt: null, taskTitle: '결과 확인', taskDetail: '원래 프로젝트에 결과 보관' }], edges: [{ source: 1, target: 2 }, { source: 2, target: 3 }], review: { summary: 'QA 생성 플로우', warnings: [] } };
const bridge = http.createServer(async (req, res) => {
  const reply = value => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (req.url === '/qa/requests') return reply(requests);
  if (req.url === '/qa/complete' && req.method === 'POST') { for (const job of jobs.values()) job.done = true; return reply({ completed: jobs.size }); }
  if (req.url === '/remote/status' || req.url === '/remote/auth/device/status') return reply({ bridge: true, authenticated: true, canRun: true, sessionPresent: true });
  if (req.url === '/remote/session/new') return reply({ id: randomBytes(32).toString('base64url') });
  if (req.url === '/remote/auth/device/start') return reply({ userCode: 'QA-TEST', verificationUrl: '', status: 'waiting' });
  if (req.url === '/remote/v1/plan') return reply({ ...graph, nodes: graph.nodes.map(({ prompt, ...node }) => prompt === null ? node : { ...node, prompt }), edges: graph.edges.map((edge, index) => ({ ...edge, id: index + 1 })) });
  if (req.url?.startsWith('/remote/jobs?')) {
    const job = jobs.get(new URL(req.url, 'http://localhost').searchParams.get('job'));
    return reply(job?.done ? { status: 'done', imageUrl } : { status: 'running' });
  }
  if (req.url === '/remote/v1/generate' || req.url === '/remote/v1/edit') {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body); requests.push({ kind: payload.kind, prompt: payload.prompt, images: payload.imageUrls?.length || 0 });
    const jobId = randomBytes(24).toString('base64url'); jobs.set(jobId, { done: false });
    return reply({ jobId, status: 'running' });
  }
  res.writeHead(404); res.end();
});
bridge.listen(4459, '127.0.0.1', () => {
  const web = spawn(process.execPath, [path.join(__dirname, '../web/node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '-p', '4450'], { cwd: path.join(__dirname, '../web'), env: { ...process.env, WEB_PORT: '4450', BRIDGE_PORT: '4459', FRAMEFLOW_SERVER_MODE: '1', FRAMEFLOW_SERVER_BRIDGE_KEY: 'isolated-background-qa', FRAMEFLOW_PUBLIC_ORIGIN: 'http://localhost:4450' }, stdio: 'inherit' });
  const stop = () => web.kill('SIGTERM'); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  web.once('exit', code => { bridge.close(); process.exitCode = code || 0; });
  console.log('Isolated background QA: http://localhost:4450/; complete jobs via POST http://127.0.0.1:4459/qa/complete');
});
