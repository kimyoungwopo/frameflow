const canvas = document.querySelector('#canvas');
const request = document.querySelector('#request');
const result = document.querySelector('#assistantResult');
const runLog = document.querySelector('#runLog');
const saveState = document.querySelector('#saveState');
const nodeMap = new Map();
const publicToken = new URLSearchParams(location.hash.slice(1)).get('access_token');
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => { const headers = new Headers(init.headers || {}); if(publicToken) headers.set('x-gpt-node-token', publicToken); return nativeFetch(input, {...init, headers}); };
let nodeCounter = 0;
let edges = [];
let selectedId = null;
let selectedEdge = null;
let drag = null;
let connectDrag = null;
let history = [];
let future = [];
let lastImageUrl = '';
function currentSnapshot() { return { configs:[...nodeMap.values()].map(({el,...config})=>({...config,x:parseFloat(el.style.left),y:parseFloat(el.style.top),promptInput:el.querySelector('.node-prompt-input')?.value||'',selectedCommands:[...(config.selectedCommands||[])]})), edges:edges.map(edge=>{const a=[...nodeMap.keys()].indexOf(edge.source), b=[...nodeMap.keys()].indexOf(edge.target); return [a,b];}) }; }
function saveHistory() { history.push(currentSnapshot()); if(history.length>30) history.shift(); future=[]; }
function restoreSnapshot(snapshot) { if(!snapshot) return; renderGraph(snapshot.configs,snapshot.edges); snapshot.configs.forEach((config,index)=>{const record=[...nodeMap.values()][index]; const input=record?.el.querySelector('.node-prompt-input'); if(input) input.value=config.promptInput||''; if(record?.type==='command'){record.selectedCommands=[...(config.selectedCommands||[])]; renderCommandNode(record);}}); }
function undo() { const previous=history.pop(); if(!previous){setLog('되돌릴 작업이 없어요','ready');return;} future.push(currentSnapshot()); restoreSnapshot(previous); setLog('이전 상태로 되돌렸어요','done'); }
function redo() { const next=future.pop(); if(!next){setLog('다시 실행할 작업이 없어요','ready');return;} history.push(currentSnapshot()); restoreSnapshot(next); setLog('작업을 다시 실행했어요','done'); }

const initial = [
  { key:'prompt', type:'prompt', title:'PROMPT', subtitle:'기본 프롬프트 + 사용자 지시', x:20, y:75, body:'작업의 기준을 정해요', cls:'input', hasIn:false, prompt:'깨끗한 제품 사진, 자연스러운 조명, 고급 광고 이미지' },
  { key:'generate', type:'generate', title:'IMAGE GENERATE', subtitle:'이미지 한 장 생성', x:260, y:75, body:'먼저 결과 이미지를 만들어요', cls:'edit' },
  { key:'preview', type:'preview', title:'PREVIEW', subtitle:'완성 결과', x:500, y:75, body:'실행 후 결과가 보여요', cls:'preview', hasOut:false },
  { key:'input', type:'image', title:'IMAGE INPUT', subtitle:'원본 제품 사진', x:20, y:330, body:'제품 사진을 작업에 넣어요', cls:'input', hasIn:false },
  { key:'edit', type:'edit', title:'GPT IMAGE EDIT', subtitle:'배경과 분위기 변경', x:260, y:330, body:'고급 광고 이미지로 편집', cls:'edit' },
  { key:'upscale', type:'upscale', title:'UPSCALE', subtitle:'선명도와 크기', x:500, y:330, body:'출력 크기 2×', cls:'upscale' }
];

function markDirty() { saveState.textContent = '변경사항 있음'; saveState.style.color = '#f0aa57'; }
function setExecutionLocation(text) { const location=document.querySelector('#executionLocation'); if(location) location.textContent=`실행 위치: ${text}`; }
function setLog(text, state='ready') { runLog.querySelector('.log-row').innerHTML = `<span class="status-dot ${state}"></span><span>${text}</span>`; }
function nodePosition(id) { const record = nodeMap.get(id); return record ? { x: parseFloat(record.el.style.left), y: parseFloat(record.el.style.top) } : null; }
function portPoint(id, side) {
  const record = nodeMap.get(id); if (!record) return null;
  const port = record.el.querySelector(`.port.${side}`); const r = (port || record.el).getBoundingClientRect(); const c = canvas.getBoundingClientRect();
  return { x: (side === 'out' ? r.right : r.left) - c.left, y: r.top - c.top + r.height / 2 };
}
function ensureEdgeLayer() {
  let svg = canvas.querySelector('.edge-layer');
  if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.classList.add('edge-layer'); canvas.prepend(svg); }
  return svg;
}
function updateDisconnectButton() { const button=document.querySelector('#disconnectBtn'); if(button) button.disabled=!selectedEdge; }
function drawEdges(temp = null) {
  const svg = ensureEdgeLayer(); svg.innerHTML = '';
  [...edges, ...(temp ? [temp] : [])].forEach(edge => {
    const a = portPoint(edge.source, 'out'), b = portPoint(edge.target, 'in'); if (!a || !b) return;
    const curve = Math.max(50, Math.abs(b.x - a.x) * .42);
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', `M ${a.x} ${a.y} C ${a.x + curve} ${a.y}, ${b.x - curve} ${b.y}, ${b.x} ${b.y}`);
    path.setAttribute('class', `graph-edge${edge.temp ? ' temp' : ''}${edge === selectedEdge ? ' selected' : ''}`);
    if (!edge.temp) path.addEventListener('click', event => { event.stopPropagation(); selectedEdge=edge; updateDisconnectButton(); drawEdges(); setLog('연결을 선택했어요. ⤫ 버튼으로 해제할 수 있어요','done'); });
    svg.appendChild(path);
  });
  updateDisconnectButton();
}
function disconnectSelectedEdge() {
  if (!selectedEdge) { setLog('먼저 연결선을 클릭해 선택해 주세요','ready'); return; }
  saveHistory(); edges=edges.filter(edge=>edge!==selectedEdge); selectedEdge=null; drawEdges(); updateMinimap(); markDirty(); setLog('선택한 연결을 해제했어요','done');
}
function selectNode(id) {
  selectedId = id; document.querySelectorAll('.wf-node').forEach(n => n.classList.toggle('selected', n.dataset.id === id));
}
function removeNode(id) {
  if (!nodeMap.has(id)) return;
  saveHistory();
  nodeMap.get(id).el.remove(); nodeMap.delete(id); edges = edges.filter(e => e.source !== id && e.target !== id); selectedId = null; selectedEdge = null; updateMinimap(); drawEdges(); markDirty(); setLog('노드를 삭제했어요', 'done');
}
function renderCommandNode(record, filter='') { const list=record.el.querySelector('.command-node-list'); const selected=record.el.querySelector('.command-node-selected'); if(!list||!selected)return; const q=filter.trim().toLowerCase(); const commands=(window.GPT_COMMANDS||[]).filter(item=>!q||item.command.toLowerCase().includes(q)||item.label.toLowerCase().includes(q)||item.category.toLowerCase().includes(q)); list.innerHTML=commands.map(item=>`<button class="command-node-item ${record.selectedCommands.includes(item.command)?'chosen':''}" data-command="${item.command}" title="${item.category} · ${item.description}"><b>${item.label}</b><small>${item.category}</small></button>`).join('')||'<span class="command-node-empty">검색 결과 없음</span>'; selected.innerHTML=record.selectedCommands.length?`선택 ${record.selectedCommands.length}개 · ${record.selectedCommands.map(code=>(window.GPT_COMMANDS.find(x=>x.command===code)?.label||code)).join(' · ')}<br><small>실행 시 영문 코드로 변환</small>`:'선택된 명령어 없음'; list.querySelectorAll('[data-command]').forEach(btn=>btn.addEventListener('click',()=>{const command=btn.dataset.command; saveHistory(); if(record.selectedCommands.includes(command)) record.selectedCommands=record.selectedCommands.filter(x=>x!==command); else record.selectedCommands.push(command); renderCommandNode(record,filter); markDirty(); setLog(`${window.GPT_COMMANDS.find(x=>x.command===command)?.label||command}을 ${record.selectedCommands.includes(command)?'선택했어요':'해제했어요'}`,'done');})); }
function addNode(config) {
  const id = config.id || `node-${++nodeCounter}`;
  const el = document.createElement('article'); el.className = 'wf-node'; el.dataset.id = id;
  el.style.left = `${config.x ?? 50}px`; el.style.top = `${config.y ?? 120}px`;
  const icon = { prompt:'✎', generate:'✦', command:'⌘', image:'▧', edit:'✦', blend:'◈', upscale:'↗', preview:'▣' }[config.type] || '•';
  const detail = { prompt:'기본 프롬프트와 내 지시를 합쳐요', generate:'프롬프트로 첫 이미지를 생성해요', command:'PDF 명령어를 여러 개 선택해요', image:'원본 이미지', edit:'AI가 장면을 편집해요', blend:'레이어를 자연스럽게 합쳐요', upscale:'디테일을 보강해요', preview:'작업 결과를 확인해요' }[config.type] || config.subtitle;
  const chips = { prompt:['기본값 있음','직접 수정'], generate:['첫 이미지','OAuth 생성'], command:['160개 명령어','다중 선택'], image:['PNG · 1장'], edit:['배경 변경','스타일'], blend:['2개 입력','자연스럽게'], upscale:['2×','고해상도'], preview:['결과 준비'] }[config.type] || [];
  const promptEditor = config.type === 'prompt' ? `<div class="prompt-default">기본: ${config.prompt || '원하는 이미지의 분위기와 품질을 설명하세요'}</div><textarea class="node-prompt-input" aria-label="사용자 프롬프트" placeholder="내 지시를 추가하세요"></textarea>` : '';
  const imageMarkup = config.imageUrl ? `<div class="node-preview image has-image"><img class="node-input-image" src="${config.imageUrl}" alt="${config.imageName || '재사용 이미지'}" /></div>` : '';
  const commandEditor = config.type === 'command' ? `<input class="command-node-search" aria-label="명령어 검색" placeholder="/PRODUCTSHOT 검색" /><div class="command-node-list"></div><div class="command-node-selected"></div>` : '';
  const canRun = ['generate','edit','blend','upscale'].includes(config.type);
  el.innerHTML = `<div class="node-title ${config.cls}" data-drag-handle="true"><span class="node-heading"><i class="node-icon">${icon}</i><span>${config.title}</span></span><span class="node-actions">${canRun ? '<button class="node-run" title="이 노드부터 실행" aria-label="이 노드부터 실행">▶</button>' : ''}<i class="node-status"></i><button class="node-delete" title="노드 삭제" aria-label="노드 삭제">×</button></span></div><div class="node-body">${promptEditor || commandEditor || imageMarkup || (config.type === 'image' || config.type === 'edit' || config.type === 'preview' ? `<div class="node-preview ${config.type}">${config.type === 'preview' ? '<span class="preview-lock">결과 대기</span>' : ''}</div>` : `<div class="node-symbol ${config.type}">${icon}</div>`)}<p>${config.subtitle}</p><small>${detail}</small><div class="node-chips">${chips.map(chip=>`<span>${chip}</span>`).join('')}</div></div>${config.hasIn === false ? '' : '<i class="port in" data-port="in" title="입력 포트"></i><span class="port-label in-label">입력</span>'}${config.hasOut === false ? '' : '<i class="port out" data-port="out" title="출력 포트"></i><span class="port-label out-label">출력</span>'}`;
  canvas.appendChild(el); nodeMap.set(id, { el, ...config }); updateMinimap();
  el.addEventListener('pointerdown', e => { if (e.target.closest('.node-delete') || e.target.closest('.port')) return; selectNode(id); });
  el.querySelector('.node-delete').addEventListener('click', e => { e.stopPropagation(); removeNode(id); });
  el.querySelector('.node-run')?.addEventListener('click', e => { e.stopPropagation(); runNode(id); });
  el.querySelector('.node-prompt-input')?.addEventListener('input', () => { markDirty(); setLog('사용자 프롬프트를 수정했어요','done'); });
  if(config.type==='command'){ const record=nodeMap.get(id); record.selectedCommands=record.selectedCommands||[]; renderCommandNode(record); el.querySelector('.command-node-search').addEventListener('input',e=>renderCommandNode(record,e.target.value)); }
  el.querySelector('[data-drag-handle]').addEventListener('pointerdown', startDrag);
  el.querySelectorAll('.port').forEach(port => port.addEventListener('pointerdown', startConnect));
  return id;
}
function startDrag(e) {
  if (e.button !== 0 || e.target.closest('.node-delete,.node-run')) return;
  const el = e.currentTarget.closest('.wf-node'); const id = el.dataset.id; selectNode(id);
  const rect = canvas.getBoundingClientRect(); saveHistory(); drag = { id, startX:e.clientX, startY:e.clientY, left:parseFloat(el.style.left), top:parseFloat(el.style.top), rect };
  e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault();
}
function moveDrag(e) {
  if (!drag) return; const record = nodeMap.get(drag.id); if (!record) return;
  const x = Math.max(8, drag.left + e.clientX - drag.startX); const y = Math.max(8, drag.top + e.clientY - drag.startY);
  record.el.style.left = `${x}px`; record.el.style.top = `${y}px`; drawEdges(); markDirty();
}
function endDrag() { if (drag) { drag = null; setLog('노드 위치를 변경했어요', 'done'); } }
function startConnect(e) {
  e.stopPropagation(); if (e.button !== 0) return;
  const port = e.currentTarget; const el = port.closest('.wf-node'); const id = el.dataset.id;
  if (port.dataset.port !== 'out') return;
  selectNode(id); connectDrag = { source:id, x:e.clientX, y:e.clientY }; drawEdges({ source:id, target:'__temp__', temp:true });
  window.addEventListener('pointermove', moveConnect); window.addEventListener('pointerup', endConnect, { once:true });
}
function moveConnect(e) { if (!connectDrag) return; connectDrag.x=e.clientX; connectDrag.y=e.clientY; const a=portPoint(connectDrag.source,'out'); const c=canvas.getBoundingClientRect(); const temp={source:connectDrag.source,target:'__temp__',temp:true}; const svg=ensureEdgeLayer(); svg.innerHTML=''; const path=document.createElementNS('http://www.w3.org/2000/svg','path'); const x2=e.clientX-c.left,y2=e.clientY-c.top,curve=Math.max(50,Math.abs(x2-a.x)*.42); path.setAttribute('d',`M ${a.x} ${a.y} C ${a.x+curve} ${a.y}, ${x2-curve} ${y2}, ${x2} ${y2}`); path.setAttribute('class','graph-edge temp'); svg.appendChild(path); }
function endConnect(e) {
  if (!connectDrag) return; const targetPort = document.elementFromPoint(e.clientX,e.clientY)?.closest('.port.in');
  if (targetPort) { const target = targetPort.closest('.wf-node').dataset.id; if (target !== connectDrag.source && !edges.some(x=>x.source===connectDrag.source&&x.target===target)) { saveHistory(); edges.push({source:connectDrag.source,target}); markDirty(); setLog('노드를 연결했어요', 'done'); } }
  connectDrag=null; drawEdges(); window.removeEventListener('pointermove',moveConnect);
}
function updateMinimap() { const minimap=document.querySelector('.minimap'); if(!minimap)return; minimap.querySelectorAll('.mini-dot,.mini-line').forEach(el=>el.remove()); const nodes=[...nodeMap.values()]; const maxX=Math.max(760,...nodes.map(n=>parseFloat(n.el.style.left)+204)); const maxY=Math.max(560,...nodes.map(n=>parseFloat(n.el.style.top)+140)); const colors={prompt:'#9d95ff',generate:'#35c9b1',image:'#7567f5',edit:'#35c9b1',blend:'#f2a550',upscale:'#75b9ff',preview:'#f178a9'}; nodes.forEach(node=>{const dot=document.createElement('span'); dot.className='mini-dot'; dot.style.left=`${10+(parseFloat(node.el.style.left)/maxX)*104}px`; dot.style.top=`${10+(parseFloat(node.el.style.top)/maxY)*58}px`; dot.style.background=colors[node.type]||'#8e83ff'; minimap.appendChild(dot);}); }
function renderGraph(configs=[], connections=[]) {
  canvas.querySelectorAll('.wf-node,.edge-layer').forEach(el => el.remove()); nodeMap.clear(); edges=[]; selectedId=null; selectedEdge=null; canvas.scrollTo({left:0,top:0});
  const ids = configs.map(addNode); edges=connections.filter(pair=>ids[pair[0]]&&ids[pair[1]]).map(pair=>({source:ids[pair[0]],target:ids[pair[1]]})); drawEdges();
}
function addResultPreview(imageUrl='') {
  const item=[...nodeMap.values()].find(x=>x.type==='preview'); if (!item) return;
  if(imageUrl) lastImageUrl=imageUrl;
  const body=item.el.querySelector('.node-body'); body.innerHTML='';
  const preview=document.createElement('div'); preview.className='node-preview preview';
  if (imageUrl) {
    const image=document.createElement('img'); image.className='node-result-image'; image.alt='생성된 이미지'; image.decoding='async'; image.loading='eager';
    image.addEventListener('error',()=>{ preview.innerHTML='<span class="preview-error">이미지를 불러오지 못했어요</span>'; }); image.src=imageUrl; preview.appendChild(image); preview.classList.add('has-image');
    body.innerHTML='<p>실제 생성 이미지가 준비됐어요</p><small>GPT Image · 다음 작업에 재사용 가능</small>'; body.prepend(preview);
    const actions=document.createElement('div'); actions.className='preview-actions';
    const reuse=document.createElement('button'); reuse.type='button'; reuse.className='preview-action primary'; reuse.textContent='＋ 이 결과로 노드 생성'; reuse.title='생성된 이미지를 IMAGE INPUT 노드로 추가';
    reuse.addEventListener('click',()=>{ saveHistory(); const id=addNode({type:'image',title:'IMAGE INPUT',subtitle:'생성 결과 재사용',body:'프리뷰에서 가져온 이미지',cls:'input',x:80+(nodeCounter%3)*220,y:470,hasIn:false,imageUrl,imageName:'생성 결과'}); selectNode(id); setLog('프리뷰 이미지를 IMAGE INPUT 노드로 만들었어요','done'); markDirty(); });
    const download=document.createElement('a'); download.className='preview-action'; download.textContent='↓ 다운로드'; download.href=imageUrl; download.download='gpt-image-result.png'; download.rel='noopener';
    actions.append(reuse,download); body.append(actions);
  } else { preview.innerHTML='<span class="preview-lock">결과 대기</span>'; body.append(preview,document.createElement('p')); body.lastElementChild.textContent='완성 이미지가 준비됐어요'; const small=document.createElement('small'); small.textContent='결과 저장 가능'; body.append(small); }
}
function generationPrompt() { const promptNode=[...nodeMap.values()].find(x=>x.type==='prompt'); const userPrompt=promptNode?.el.querySelector('.node-prompt-input')?.value.trim()||''; const base=promptNode?.prompt||''; const commands=executionCommands(); return [base,userPrompt,request.value.trim(),commands.length?`적용할 이미지 연출: ${commands.join(' ')}`:''].filter(Boolean).join('. '); }

function plan() {
  const text=request.value.trim(); if(!text) return;
  renderGraph(initial, [[0,1],[1,2],[3,4],[4,5],[5,2]]);
  result.innerHTML='<span class="result-icon">✓</span><div><b>기본 작업을 구성했어요</b><p>이미지 입력 → 편집 → 업스케일 → 미리보기</p></div>';
  document.querySelector('.badge').textContent='구성 완료';
  setLog('작업 순서를 구성했어요','done');
  markDirty();
}
function executionCommands() { return [...nodeMap.values()].filter(node=>node.type==='command').flatMap(node=>node.selectedCommands||[]).filter((code,index,all)=>all.indexOf(code)===index); }
function connectedPath(nodeId) { const labels=new Map([...nodeMap].map(([id,node])=>[id,node.title])); const chain=[nodeId]; let current=nodeId; while(true){const next=edges.find(edge=>edge.source===current)?.target;if(!next||chain.includes(next))break;chain.push(next);current=next;} return chain.map(id=>labels.get(id)||'노드').join(' → '); }
function wantsCutout() { const promptNode=[...nodeMap.values()].find(node=>node.type==='prompt'); const text=[request.value,promptNode?.el.querySelector('.node-prompt-input')?.value||''].join(' '); return /누끼|배경\s*제거|투명\s*배경/.test(text); }
async function runNode(nodeId) { const node=nodeMap.get(nodeId); if(!node)return; selectNode(nodeId); const path=connectedPath(nodeId); if(node.type==='generate'){ run(nodeId); return; } if(node.type!=='edit'&&node.type!=='upscale'){setExecutionLocation(`로컬 서버 127.0.0.1:4184 · ${path}`);setLog(`${node.title}는 직접 실행할 수 없는 설정 노드예요`,'ready');return;} if(!lastImageUrl){setExecutionLocation(`로컬 서버 127.0.0.1:4184 · ${node.title}`);setLog('먼저 IMAGE GENERATE를 실행해 입력 이미지를 만들어 주세요','ready');return;} const prompt=editPrompt(node.type); const cutout=wantsCutout(); const endpoint=cutout?'/api/remove-background':'/api/edit'; setExecutionLocation(`로컬 서버 127.0.0.1:4184 · ${cutout?'IMAGE INPUT → REMOVE BACKGROUND → PREVIEW':path}`); setLog(`로컬 서버에서 ${cutout?'누끼 제거':' '+node.title}를 실행하는 중이에요…`,'running'); node.el.classList.add('node-running'); try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cutout?{imageUrl:lastImageUrl}:{imageUrl:lastImageUrl,prompt,size:'1024x1024',quality:'medium'})}); const data=await response.json(); if(!response.ok)throw new Error(data.message||'image_edit_failed'); addResultPreview(data.imageUrl); setExecutionLocation(`로컬 서버 127.0.0.1:4184 · ${cutout?'REMOVE BACKGROUND → PREVIEW':path} 완료`); setLog(cutout?'누끼 제거 완료':`${node.title} 개별 실행 완료`,'done');}catch(error){setExecutionLocation(`로컬 서버 127.0.0.1:4184 · ${node.title} 실패`);setLog(error.message||'개별 실행에 실패했어요','ready');}finally{node.el.classList.remove('node-running');} }
function editPrompt(nodeType='edit') { const promptNode=[...nodeMap.values()].find(node=>node.type==='prompt'); const base=promptNode?.prompt||''; const userPrompt=promptNode?.el.querySelector('.node-prompt-input')?.value.trim()||''; const requestPrompt=request.value.trim(); const commands=executionCommands(); const commandText=commands.length?`선택한 연출 코드: ${commands.join(', ')}`:''; const preserve='입력 이미지의 동일한 제품과 형태를 반드시 유지하세요. 다른 제품, 시계, 병, 로고, 소재로 바꾸지 마세요.'; const instruction=nodeType==='upscale'?'원본 이미지의 구도와 제품을 바꾸지 말고 고해상도와 선명도만 보강하세요.':(userPrompt||requestPrompt||'원본 제품 이미지를 자연스럽게 편집하세요.'); return [preserve,base,instruction,requestPrompt!==instruction?requestPrompt:'',commandText].filter(Boolean).join('. '); }
async function run(startNodeId=null) { const prompt=generationPrompt(); const codes=executionCommands(); const start=nodeMap.get(startNodeId); const hasSource=Boolean(lastImageUrl&&[...nodeMap.values()].some(node=>node.type==='image'&&node.imageUrl)); const cutout=hasSource&&wantsCutout(); if(!prompt){setExecutionLocation('실행 대기 · PROMPT 입력 필요');setLog('이미지 설명을 입력해 주세요','ready');return;} const path=cutout?'IMAGE INPUT → REMOVE BACKGROUND → PREVIEW':(hasSource?'IMAGE INPUT → GPT IMAGE EDIT → PREVIEW':(startNodeId?connectedPath(startNodeId):'PROMPT → IMAGE GENERATE → PREVIEW')); setExecutionLocation(`로컬 서버 127.0.0.1:4184 · ${path}`); setLog(`로컬 서버에서 ${cutout?'누끼 제거':(hasSource?'입력 이미지 편집':'IMAGE GENERATE')}를 실행하는 중이에요…`,'running'); document.querySelector('.badge').textContent='생성 중'; try { const endpoint=cutout?'/api/remove-background':(hasSource?'/api/edit':'/api/generate'); const body=cutout?{imageUrl:lastImageUrl}:(hasSource?{imageUrl:lastImageUrl,prompt:editPrompt('edit'),size:'1024x1024',quality:'medium'}:{prompt,size:'1024x1024',quality:'medium'}); const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const data=await response.json(); if(!response.ok) throw new Error(data.message||'image_generation_failed'); addResultPreview(data.imageUrl); setExecutionLocation(`로컬 서버 127.0.0.1:4184 · ${path} 완료`); setLog(cutout?'누끼 제거 완료':(hasSource?'입력 이미지 편집 완료':(codes.length?`실제 생성 완료 · ${codes.join(' ')} 적용`:'실제 이미지 생성 완료')),'done'); document.querySelector('.badge').textContent='생성 완료'; } catch(error) { setExecutionLocation(`로컬 서버 127.0.0.1:4184 · ${path} 실패`); setLog(error.message||'이미지 실행에 실패했어요','ready'); document.querySelector('.badge').textContent='생성 실패'; } }
document.addEventListener('pointermove', moveDrag); document.addEventListener('pointerup', endDrag); document.addEventListener('keydown', e => { if ((e.key==='Delete'||e.key==='Backspace') && selectedEdge && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); disconnectSelectedEdge(); return; } if ((e.key==='Delete'||e.key==='Backspace') && selectedId && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') removeNode(selectedId); });
canvas.addEventListener('pointerdown', e => { if (e.target === canvas) { selectedId=null; selectedEdge=null; updateDisconnectButton(); document.querySelectorAll('.wf-node').forEach(n=>n.classList.remove('selected')); drawEdges(); } });
document.querySelector('#planBtn').addEventListener('click', plan); document.querySelector('#applyBtn').addEventListener('click', run); document.querySelector('#runBtn').addEventListener('click', run);
document.querySelector('#resetBtn').addEventListener('click', () => { request.value=''; result.innerHTML='<span class="result-icon">✓</span><div><b>아직 작업이 없어요</b><p>오른쪽에 원하는 작업을 적어보세요</p></div>'; setLog('대기 중이에요'); renderGraph(); });
document.querySelector('#saveBtn').addEventListener('click', () => { localStorage.setItem('gpt-node-studio-workflow', JSON.stringify({ request:request.value, snapshot:currentSnapshot(), savedAt:new Date().toISOString()})); saveState.textContent='저장됨'; saveState.style.color='#7fcfb8'; setLog('워크플로우를 저장했어요','done'); });
document.querySelectorAll('[data-add]').forEach(btn=>btn.addEventListener('click',()=>{ const type=btn.dataset.add; const map={prompt:['PROMPT','프롬프트','기본값 + 내 지시를 함께 사용','input'],generate:['IMAGE GENERATE','이미지 생성','한 장 먼저 만들어요','edit'],command:['명령어 선택','PDF 명령어를 조합해요','한글로 선택하고 실행할 때 코드로 바꿔요','input'],image:['IMAGE INPUT','이미지 입력','사진을 작업에 넣어요','input'],edit:['GPT IMAGE EDIT','이미지 편집','자연어로 이미지 변경','edit'],blend:['BLEND','이미지 합치기','여러 결과물을 하나로','blend'],upscale:['UPSCALE','업스케일','출력 크기 개선','upscale'],preview:['PREVIEW','완성 결과','실행 결과 확인','preview']}; const [title,subtitle,body,cls]=map[type]; saveHistory(); const id=addNode({type,title,subtitle,body,cls,x:80+(nodeCounter%3)*220,y:470,hasOut:type!=='preview',prompt:type==='prompt'?'깨끗한 제품 사진, 자연스러운 조명, 고급 광고 이미지':''}); selectNode(id); explainNode(type); setLog(`${subtitle} 노드를 추가했어요`,'done'); markDirty(); }));
function explainNode(type) { const guide={prompt:['프롬프트','기본 프롬프트에 사용자의 추가 지시를 더해 이미지 작업의 방향을 정해요.'],generate:['이미지 생성','프롬프트만으로 첫 이미지 한 장을 만들어요. 생성 후 편집·업스케일을 이어갈 수 있어요.'],command:['명령어 선택','PDF에서 추출한 명령어를 검색하고 여러 개 선택해 실행 명령으로 변환해요.'],image:['이미지 입력','작업에 사용할 원본 이미지나 참고 이미지를 넣어요.'],edit:['GPT 이미지 편집','자연어 지시로 배경, 분위기, 스타일, 일부 요소를 바꿔요.'],blend:['이미지 합치기','두 개 이상의 이미지나 레이어를 하나의 결과로 합쳐요.'],upscale:['업스케일','이미지를 더 크게 만들고 선명도를 보강해요.'],preview:['미리보기','현재 workflow의 결과를 실행 전에 확인하는 마지막 단계예요.']}; const item=guide[type]||guide.edit; document.querySelector('#nodeGuide').innerHTML=`<b>${item[0]}</b><p>${item[1]}</p>`; }
document.querySelectorAll('[data-add]').forEach(btn=>btn.addEventListener('mouseenter',()=>explainNode(btn.dataset.add)));
document.querySelector('#addNodeFromText').addEventListener('click',()=>{ const text=document.querySelector('#nodeRequest').value.trim(); if(!text){ setLog('추가할 노드를 자연어로 적어주세요','ready'); return; } const type=/명령어|command|PDF|\/([A-Z0-9]+)/.test(text)?'command':/이미지 생성|generate|한 장/.test(text)?'generate':/프롬프트|prompt|지시|문장/.test(text)?'prompt':/합치|합성|blend|두 이미지/.test(text)?'blend':/업스케일|확대|선명|고해상도/.test(text)?'upscale':/미리보기|preview|결과 확인/.test(text)?'preview':/이미지 입력|사진 넣|원본/.test(text)?'image':'edit'; const labels={command:['명령어 선택','명령어 조합',text,'input'],generate:['IMAGE GENERATE','이미지 생성',text,'edit'],prompt:['PROMPT','프롬프트','기본값 + 내 지시를 함께 사용','input'],image:['IMAGE INPUT','이미지 입력','사진을 작업에 넣어요','input'],edit:['GPT IMAGE EDIT','이미지 편집',text,'edit'],blend:['BLEND','이미지 합치기',text,'blend'],upscale:['UPSCALE','업스케일',text,'upscale'],preview:['PREVIEW','완성 결과',text,'preview']}; const [title,subtitle,body,cls]=labels[type]; saveHistory(); const id=addNode({type,title,subtitle,body,cls,x:80+(nodeCounter%3)*220,y:470,hasOut:type!=='preview',prompt:'깨끗한 제품 사진, 자연스러운 조명, 고급 광고 이미지'}); selectNode(id); explainNode(type); document.querySelector('#nodeRequest').value=''; setLog(`${subtitle} 노드를 만들었어요`,'done'); markDirty(); });

function handleImageFile(file){ if(!file||!file.type.startsWith('image/')){setLog('PNG, JPG, WEBP 같은 이미지 파일만 추가할 수 있어요','ready');return;} const url=URL.createObjectURL(file); let inputNode=[...nodeMap.values()].find(x=>x.type==='image'); if(!inputNode){saveHistory(); const id=addNode({type:'image',title:'IMAGE INPUT',subtitle:'업로드 이미지',body:'작업에 사용할 원본 이미지',cls:'input',x:80+(nodeCounter%3)*220,y:470,hasIn:false}); inputNode=nodeMap.get(id);} const preview=inputNode.el.querySelector('.node-preview'); if(preview){preview.innerHTML='';preview.classList.add('has-image');const image=document.createElement('img');image.className='node-input-image';image.alt=file.name;image.onload=()=>URL.revokeObjectURL(url);image.onerror=()=>{preview.innerHTML='<span class="preview-error">이미지를 불러오지 못했어요</span>';};image.src=url;preview.appendChild(image);} inputNode.imageUrl=url; inputNode.imageName=file.name; const reader=new FileReader(); reader.onload=()=>{inputNode.imageUrl=reader.result;lastImageUrl=reader.result;}; reader.readAsDataURL(file); setLog(`${file.name}을(를) IMAGE INPUT에 추가했어요`,'done'); markDirty(); }
const uploadBox=document.querySelector('#uploadBox'); const fileInput=document.querySelector('#fileInput'); uploadBox.addEventListener('click',()=>fileInput.click()); uploadBox.addEventListener('dragover',e=>{e.preventDefault();uploadBox.classList.add('dragover');}); uploadBox.addEventListener('dragleave',()=>uploadBox.classList.remove('dragover')); uploadBox.addEventListener('drop',e=>{e.preventDefault();uploadBox.classList.remove('dragover');handleImageFile(e.dataTransfer.files[0]);}); fileInput.addEventListener('change',e=>{handleImageFile(e.target.files[0]);e.target.value='';});
function loadSaved(kind) { const local=JSON.parse(localStorage.getItem('gpt-node-studio-workflow')||'null'); if(kind==='local'&&local?.snapshot){request.value=local.request||''; restoreSnapshot(local.snapshot); setLog('저장한 워크플로우를 불러왔어요','done'); return;} const configs=initial.map(item=>({...item})); if(kind==='character'){configs[0].prompt='캐릭터 일러스트, 선명한 윤곽, 따뜻한 색감'; configs[1].subtitle='캐릭터 원본 이미지'; configs[2].subtitle='캐릭터 스타일 편집'; request.value='캐릭터 이미지를 따뜻한 일러스트 스타일로 편집해줘';} else {request.value='제품 사진을 고급 광고 이미지로 만들어줘';} renderGraph(configs,[[0,1],[1,2],[3,4],[4,5],[5,2]]); setLog('저장한 작업을 불러왔어요','done'); markDirty(); }
document.querySelectorAll('[data-load]').forEach(btn=>btn.addEventListener('click',()=>loadSaved(btn.dataset.load)));
document.querySelector('#undoBtn').addEventListener('click',undo); document.querySelector('#redoBtn').addEventListener('click',redo); document.querySelector('#disconnectBtn').addEventListener('click',disconnectSelectedEdge);
document.querySelector('#selectTool').addEventListener('click',()=>{canvas.classList.remove('pan-mode'); document.querySelector('#selectTool').classList.add('active'); document.querySelector('#panTool').classList.remove('active'); setLog('선택 모드예요');});
document.querySelector('#panTool').addEventListener('click',()=>{canvas.classList.add('pan-mode'); document.querySelector('#panTool').classList.add('active'); document.querySelector('#selectTool').classList.remove('active'); setLog('손 이동 모드예요');});
let panDrag=null;
canvas.addEventListener('pointerdown',e=>{if(!canvas.classList.contains('pan-mode')||e.target!==canvas)return; panDrag={x:e.clientX,y:e.clientY,left:canvas.scrollLeft,top:canvas.scrollTop}; canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!panDrag)return; canvas.scrollLeft=panDrag.left-(e.clientX-panDrag.x); canvas.scrollTop=panDrag.top-(e.clientY-panDrag.y);});
canvas.addEventListener('pointerup',()=>{panDrag=null;});
document.querySelector('#fitBtn').addEventListener('click',()=>{updateZoom(90); canvas.scrollTo({left:0,top:0,behavior:'smooth'}); setLog('전체 workflow를 화면에 맞췄어요','done');});
window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault(); e.shiftKey?redo():undo();}});
let zoom=90;
function updateZoom(next){ zoom=Math.max(70,Math.min(140,next)); document.querySelectorAll('.zoom-value,#zoomLabel').forEach(el=>el.textContent=`${zoom}%`); document.querySelector('.canvas').style.setProperty('--node-zoom',zoom/100); document.querySelector('.canvas').style.backgroundSize=`${24*zoom/100}px ${24*zoom/100}px`; }
document.querySelector('#zoomIn').addEventListener('click',()=>updateZoom(zoom+10));
document.querySelector('#zoomOut').addEventListener('click',()=>updateZoom(zoom-10));
async function refreshLocalStatus({silent=false}={}) { const status=document.querySelector('#localStatus'); try { const response=await fetch('/api/local/status',{cache:'no-store'}); const data=await response.json(); if(!response.ok) throw new Error('로컬 브리지 상태를 확인할 수 없어요'); status.textContent=data.authenticated?'로컬 서버 · 로그인됨':'웹 서버 연결됨 · 로그인 실행기 없음'; status.title=data.authenticated?'우리 프로젝트 전용 세션 사용 중':'프로젝트 전용 Local Bridge 설치 필요'; if(!silent) setLog(data.authenticated?'로컬 서버와 로그인 상태를 확인했어요':'웹 서버는 연결됐지만 로그인 실행기가 없어요',data.authenticated?'done':'ready'); return data; } catch(error) { status.textContent='로컬 실행기 연결 안 됨'; status.title=error.message; if(!silent) setLog('로컬 실행기를 찾지 못했어요','ready'); return null; } }
document.querySelector('#localStatusBtn').addEventListener('click',()=>refreshLocalStatus());
document.querySelector('#loginHelpBtn').addEventListener('click',()=>{ document.querySelector('#assistantResult').innerHTML='<span class="result-icon">!</span><div><b>로그인 실행기가 아직 없어요</b><p>현재는 웹 UI와 로컬 서버만 실행 중입니다. 먼저 프로젝트 전용 Local Bridge를 설치해야 공식 OAuth 로그인과 이미지 실행을 연결할 수 있어요.</p></div>'; setLog('현재 로그인 실행기가 없어 OAuth 로그인을 시작할 수 없어요. 먼저 Local Bridge를 설치해야 해요','ready'); document.querySelector('#localStatus').title='프로젝트 전용 Local Bridge 설치 필요'; });
refreshLocalStatus({silent:true});
renderGraph();
