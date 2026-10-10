'use client';

import { localBridgeFetch } from './local-bridge';
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { executeWorkflow, validateWorkflow, workflowGroups, estimateRequests, WorkflowExecutionError } from './workflow-engine';
import type { AnimationEncoder, NodeType } from './workflow-engine';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import UPNG from 'upng-js';
import { parseProjectBackup } from './project-backup';
import { imageOutputFormat } from './image-format';
import { saveImageRecords, loadImageRecords, deleteImageRecords, deleteProjectImageRecords } from './image-store';
import { COMMAND_CATEGORIES } from './command-catalog';
import { buildSharedCutout, expandedGroupIds, groupBounds, parseGroups, HISTORY_LIMIT } from './studio-groups';
import type { StudioGroup } from './studio-groups';
import { runBatch } from './batch-runner';
import { GroupPanel } from './group-panel';
import type { BatchTask } from './group-panel';
import { sharedJobs, estimateSharedRequests, composeSheet } from './shared-flow';
import type { StudioImage, BatchOutput } from './shared-flow';
import { imageMetadata, nodeImageRecords, imageRecordKeys, restoreNodeImages } from './project-images';
import { ImageBatchPanel } from './image-batch-panel';
import { ResultsPanel } from './results-panel';
import { addResult, resultUnits, imageDownloadName } from './result-folders';
import type { ResultFolder, ImageResult } from './result-folders';
import { buildTaskFlow, makeTemplate, parseTemplates, instantiateTemplate, TEMPLATE_STORAGE_KEY, stylePrompt, styleTargetIds, transparentOperationIds } from './workflow-tools';
import type { CommonStyle, VisualTaskId, WorkflowTemplate } from './workflow-tools';
import { VisualTaskCards, TemplatePanel, CommonStylePanel } from './workflow-tools-panel';
import { planningSources, planningPrompt, materializePlan } from './workflow-plan';
import { WorkflowPlanPanel } from './workflow-plan-panel';
import { snapshotFlow, snapshotMatches, editingPrompt, prepareFlowEdit, replaceFlow } from './workflow-edit';
import type { EditSnapshot } from './workflow-edit';
import { WorkflowEditPanel } from './workflow-edit-panel';
import { EditNodePanel } from './edit-node-panel';
import { ProjectWorkspaces } from './project-workspaces';
import type { WorkspaceProps } from './project-workspaces';

type StudioNode = { id: number; type: NodeType; title: string; subtitle: string; x: number; y: number; imageUrl?: string; imageName?: string; prompt?: string; groupId?: string; images?: readonly StudioImage[]; batchOutput?: BatchOutput; batchSignature?: string; resultFolder?: ResultFolder; previewMode?: BatchOutput; commonStyle?: CommonStyle; taskTitle?: string; taskDetail?: string };
type Edge = { id: number; source: number; target: number };
type FlowEditDraft = { snapshot: EditSnapshot<StudioNode>; built: ReturnType<typeof prepareFlowEdit>; instruction: string; scope: string };
type ImageHistoryEntry = ImageResult;
type SavedProject = { id: string; name: string; updatedAt: string };
type DeviceAuthState = { userCode: string; verificationUrl: string; status: 'preparing' | 'waiting' | 'authenticated' | 'expired' | 'error' };

function createUniqueId(usedIds: Iterable<number>) { const used = new Set(usedIds); let id = Date.now(); while (used.has(id)) id += 1; return id; }

const nodeCatalog: Record<NodeType, { title: string; subtitle: string }> = {
  prompt: { title: '프롬프트', subtitle: '기본값 + 내 지시' }, generate: { title: '이미지 생성', subtitle: '이미지 한 장 생성' }, command: { title: '연출 명령', subtitle: '이미지 연출 명령 선택' }, image: { title: '이미지 입력', subtitle: '사진을 작업에 넣기' }, edit: { title: '이미지 편집', subtitle: '부분·스타일 변경' }, blend: { title: '이미지 합성', subtitle: '이미지 합치기' }, upscale: { title: '선명도 개선', subtitle: '이미지 디테일과 선명도 개선' }, repeat: { title: '반복 개선', subtitle: '결과를 제한 횟수만큼 개선' }, motion: { title: '스프라이트 모션', subtitle: '픽셀 게임 GIF 애니메이션 만들기' }, preview: { title: '결과 미리보기', subtitle: '완성 결과 확인' }
};
const normalizeNodes = (items: readonly StudioNode[]) => items.map((node) => ({ ...node, ...nodeCatalog[node.type], title: node.taskTitle || nodeCatalog[node.type].title, subtitle: node.taskDetail || nodeCatalog[node.type].subtitle }));
type PresetDefinition = { id: string; title: string; description: string; request: string; build: (base: number) => { nodes: StudioNode[]; edges: Edge[] } };
const presetDefinitions: PresetDefinition[] = [
  { id: 'product-ad', title: '제품 광고 이미지', description: '제품 사진을 광고용 이미지로 변환', request: '제품 사진을 깔끔한 광고 이미지로 만들고 상품이 잘 보이게 해줘.', build: (base) => { const nodes = [{ id: base, type: 'image' as NodeType, ...nodeCatalog.image, x: 70, y: 150 }, { id: base + 1, type: 'prompt' as NodeType, ...nodeCatalog.prompt, prompt: '깔끔한 광고 배경과 조명으로 제품을 돋보이게 해줘. 이미지 안에는 글자, 문구, 타이포그래피, 로고, 워터마크, 가격표를 넣지 말고 제품과 배경만 표현해줘. No text, no typography, no logo, no watermark, no labels.', x: 70, y: 380 }, { id: base + 2, type: 'edit' as NodeType, ...nodeCatalog.edit, x: 390, y: 245 }, { id: base + 3, type: 'preview' as NodeType, ...nodeCatalog.preview, x: 590, y: 245 }]; return { nodes, edges: [{ id: base + 10, source: base, target: base + 2 }, { id: base + 11, source: base + 1, target: base + 2 }, { id: base + 12, source: base + 2, target: base + 3 }] }; } },
  { id: 'text-to-image', title: '텍스트로 이미지 생성', description: '설명과 연출 명령으로 새 이미지 생성', request: '따뜻한 자연광의 감성적인 제품 사진을 만들어줘.', build: (base) => { const nodes = [{ id: base, type: 'prompt' as NodeType, ...nodeCatalog.prompt, prompt: '따뜻한 자연광의 감성적인 제품 사진', x: 70, y: 150 }, { id: base + 1, type: 'command' as NodeType, ...nodeCatalog.command, prompt: '/PRODUCTSHOT', x: 70, y: 390 }, { id: base + 2, type: 'generate' as NodeType, ...nodeCatalog.generate, x: 390, y: 245 }, { id: base + 3, type: 'preview' as NodeType, ...nodeCatalog.preview, x: 590, y: 245 }]; return { nodes, edges: [{ id: base + 10, source: base, target: base + 2 }, { id: base + 11, source: base + 1, target: base + 2 }, { id: base + 12, source: base + 2, target: base + 3 }] }; } },
  { id: 'blend-two', title: '두 이미지 합성', description: '두 입력 이미지를 하나의 결과로 합치기', request: '두 이미지를 자연스럽고 일관된 한 장의 이미지로 합쳐줘.', build: (base) => { const nodes = [{ id: base, type: 'image' as NodeType, ...nodeCatalog.image, x: 70, y: 120 }, { id: base + 1, type: 'image' as NodeType, ...nodeCatalog.image, x: 70, y: 360 }, { id: base + 2, type: 'blend' as NodeType, ...nodeCatalog.blend, x: 390, y: 245 }, { id: base + 3, type: 'preview' as NodeType, ...nodeCatalog.preview, x: 590, y: 245 }]; return { nodes, edges: [{ id: base + 10, source: base, target: base + 2 }, { id: base + 11, source: base + 1, target: base + 2 }, { id: base + 12, source: base + 2, target: base + 3 }] }; } },
  { id: 'upscale', title: '해상도 개선', description: '입력 이미지의 디테일과 선명도 개선', request: '원본 피사체와 디테일을 유지하면서 해상도와 선명도를 높여줘.', build: (base) => { const nodes = [{ id: base, type: 'image' as NodeType, ...nodeCatalog.image, x: 70, y: 150 }, { id: base + 1, type: 'upscale' as NodeType, ...nodeCatalog.upscale, x: 390, y: 245 }, { id: base + 2, type: 'preview' as NodeType, ...nodeCatalog.preview, x: 590, y: 245 }]; return { nodes, edges: [{ id: base + 10, source: base, target: base + 1 }, { id: base + 11, source: base + 1, target: base + 2 }] }; } },
  { id: 'multi-cutout', title: '여러 이미지 누끼', description: '입력 하나 · 공통 처리 · 개별 결과 폴더', request: '각 사진의 피사체를 보존하고 배경만 제거해 투명 PNG를 각각 만들어줘.', build: (base) => ({
    nodes: [
      { id: base, type: 'image', ...nodeCatalog.image, x: 70, y: 150, images: [], batchOutput: 'each' },
      { id: base + 1, type: 'command', ...nodeCatalog.command, x: 360, y: 150, prompt: '/REMOVEBG Preserve the original subject and remove only the background. Return transparent PNG.' },
      { id: base + 2, type: 'edit', ...nodeCatalog.edit, x: 600, y: 150 },
      { id: base + 3, type: 'preview', ...nodeCatalog.preview, x: 840, y: 150 }
    ],
    edges: [{ id: base + 4, source: base, target: base + 1 }, { id: base + 5, source: base + 1, target: base + 2 }, { id: base + 6, source: base + 2, target: base + 3 }]
  }) }

];
const MAX_IMAGE_DIMENSION = 2048;
const IMAGE_QUALITY = 0.82;

async function optimizeImageDataUrl(source: Blob | string): Promise<string> {
  const sourceUrl = typeof source === 'string' ? source : URL.createObjectURL(source);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('이미지 해상도를 읽지 못했어요'));
      element.src = sourceUrl;
    });
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이미지 변환을 지원하지 않는 브라우저예요');
    context.drawImage(image, 0, 0, width, height);
    const format = imageOutputFormat(source);
    return canvas.toDataURL(format, IMAGE_QUALITY);
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(sourceUrl);
  }
}

const normalizeGifPixels = (source: Uint8ClampedArray) => {
  const pixels = new Uint8ClampedArray(source);
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) {
      pixels[index] = 0; pixels[index + 1] = 0; pixels[index + 2] = 0; pixels[index + 3] = 0;
    } else {
      pixels[index + 3] = 255;
    }
  }
  return pixels;
};

const splitMotionAtlas = async (source: string, frameCount: number): Promise<readonly string[]> => {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const item = new Image(); item.onload = () => resolve(item); item.onerror = () => reject(new Error('모션 atlas를 읽지 못했어요')); item.src = source; });
  if (!Number.isInteger(frameCount) || frameCount < 1 || image.naturalWidth % frameCount !== 0) throw new Error('모션 atlas의 가로 셀 크기가 프레임 수와 맞지 않아요');
  const cellWidth = image.naturalWidth / frameCount;
  const frames: string[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const canvas = document.createElement('canvas'); canvas.width = cellWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d'); if (!context) throw new Error('모션 atlas 프레임을 자르지 못했어요');
    context.imageSmoothingEnabled = false; context.clearRect(0, 0, cellWidth, image.naturalHeight); context.drawImage(image, index * cellWidth, 0, cellWidth, image.naturalHeight, 0, 0, cellWidth, image.naturalHeight);
    frames.push(canvas.toDataURL('image/png'));
  }
  return frames;
};

const encodeGif: AnimationEncoder = async (frames, fps) => {
  const loaded = await Promise.all(frames.map((src) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('모션 프레임을 읽지 못했어요')); image.src = src; })));
  const width = Math.max(...loaded.map(image => image.naturalWidth));
  const height = Math.max(...loaded.map(image => image.naturalHeight));
  const framePixels = loaded.map((image) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('GIF 캔버스를 만들지 못했어요');
    context.clearRect(0, 0, width, height); context.imageSmoothingEnabled = false; context.drawImage(image, 0, 0, width, height);
    return normalizeGifPixels(context.getImageData(0, 0, width, height).data);
  });
  const combinedPixels = new Uint8ClampedArray(framePixels.reduce((total, pixels) => total + pixels.length, 0));
  let offset = 0;
  for (const pixels of framePixels) { combinedPixels.set(pixels, offset); offset += pixels.length; }
  const palette = quantize(combinedPixels, 256, { format: 'rgba4444' });
  const transparentIndex = palette.findIndex((color: number[]) => color[3] === 0);
  const encoder = GIFEncoder();
  for (const pixels of framePixels) {
    encoder.writeFrame(applyPalette(pixels, palette, 'rgba4444'), width, height, { palette, delay: Math.round(1000 / fps), repeat: 0, dispose: 2, transparent: transparentIndex >= 0, transparentIndex: transparentIndex >= 0 ? transparentIndex : 0 });
  }
  encoder.finish();
  const bytes = encoder.bytes(); let binary = ''; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
  return `data:image/gif;base64,${btoa(binary)}`;
};
const encodeApng: AnimationEncoder = async (frames, fps) => {
  const loaded = await Promise.all(frames.map((src) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('모션 프레임을 읽지 못했어요')); image.src = src; })));
  const width = Math.max(...loaded.map(image => image.naturalWidth));
  const height = Math.max(...loaded.map(image => image.naturalHeight));
  const buffers = loaded.map((image) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('APNG 캔버스를 만들지 못했어요'); context.clearRect(0, 0, width, height); context.imageSmoothingEnabled = false; context.drawImage(image, 0, 0, width, height); return context.getImageData(0, 0, width, height).data.buffer; });
  const bytes = new Uint8Array(UPNG.encode(buffers, width, height, 0, frames.map(() => Math.round(1000 / fps))));
  let binary = ''; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
  return `data:image/apng;base64,${btoa(binary)}`;
};


export default function StudioPage() {
  return createElement(ProjectWorkspaces, { Workspace: StudioWorkspace });
}

function StudioWorkspace({ initialProjectId, active = true, navigation, backgroundProjects = [] }: WorkspaceProps = {}) {
  const activeWorkspace = useRef(active);
  activeWorkspace.current = active;
  const projectTransition = useRef(false);
  const [nodes, setNodes] = useState<StudioNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [groups, setGroups] = useState<StudioGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectionIds, setSelectionIds] = useState<number[]>([]);
  const [uploading, setUploading] = useState(false);
  const [batchTasks, setBatchTasks] = useState<BatchTask[]>([]);
  const [groupDrag, setGroupDrag] = useState<{ pointerX: number; pointerY: number; positions: { id: number; x: number; y: number }[] } | null>(null);
  const [request, setRequest] = useState('');
  const [status, setStatus] = useState('연결 확인 중');
  const [message, setMessage] = useState('아직 작업이 없어요');
  const [selected, setSelected] = useState<number | null>(null);
  const [connectSource, setConnectSource] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ id: number; pointerX: number; pointerY: number; nodeX: number; nodeY: number } | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imageName, setImageName] = useState('');
  const [history, setHistory] = useState<ImageHistoryEntry[]>([]);
  const [viewerImage, setViewerImage] = useState<ImageHistoryEntry | null>(null);
  const [runState, setRunState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const planningRef = useRef<AbortController | null>(null);
  const [planning, setPlanning] = useState(false);
  const executionRef = useRef<AbortController | null>(null);
  const runningNodeIds = useRef<ReadonlySet<number>>(new Set());
  const nodeBusy = (id: number | null) => id !== null && runningNodeIds.current.has(id);
  useEffect(() => () => { executionRef.current?.abort(); planningRef.current?.abort(); }, []);
  const [runLabel, setRunLabel] = useState('실행 대기');
  const [runProgress, setRunProgress] = useState('');
  const [runMetrics, setRunMetrics] = useState({ requested: 0, total: 0, completed: 0, failed: 0, stage: '대기 중' });
  const [activeNodeIds, setActiveNodeIds] = useState<number[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [hydrationFailed, setHydrationFailed] = useState(false);
  const storageQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSave = useRef<(() => Promise<void>) | null>(null);
  const flushStorage = () => {
    const save = pendingSave.current;
    if (save) {
      pendingSave.current = null;
      storageQueue.current = storageQueue.current.then(save, save);
    }
    return storageQueue.current;
  };
  const [projectName, setProjectName] = useState('빈 작업실');
  const [currentProjectId, setCurrentProjectId] = useState('default');
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [showProjects, setShowProjects] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  useEffect(() => {
    if (hydrated) navigation?.update({ id: currentProjectId, name: projectName.trim() || '빈 작업실', busy: runState === 'running' || planning });
  }, [hydrated, currentProjectId, projectName, runState, planning, navigation]);
  useEffect(() => {
    if (active) {
      try { setProjects(JSON.parse(localStorage.getItem('gpt-node-studio-projects-v1') || '[]')); }
      catch { setMessage('저장된 프로젝트 목록을 읽지 못했어요.'); }
    } else { setDrag(null); setGroupDrag(null); setBoardDrag(null); setShowProjects(false); }
  }, [active]);
  const [deviceAuth, setDeviceAuth] = useState<DeviceAuthState | null>(null);
  useEffect(() => {
    if (deviceAuth?.status !== 'waiting') return;
    const controller = new AbortController();
    const deadline = Date.now() + 15 * 60 * 1000;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await localBridgeFetch('/auth/device/status', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
        if (!response.ok) throw new Error('로그인 상태를 확인하지 못했어요. 다시 시도해 주세요.');
        const data: unknown = await response.json();
        if (typeof data !== 'object' || data === null) throw new Error('로그인 상태 응답을 읽지 못했어요.');
        if ('authenticated' in data && data.authenticated === true) {
          setDeviceAuth((current) => current ? { ...current, status: 'authenticated' } : current);
          setStatus('연결됨'); setMessage('계정 연결이 완료됐어요'); return;
        }
        const state = 'status' in data ? data.status : null;
        if (state === 'error' || state === 'expired' || Date.now() >= deadline) {
          setDeviceAuth((current) => current ? { ...current, status: state === 'error' ? 'error' : 'expired' } : current);
          setMessage('계정 연결이 만료되거나 실패했어요. 다시 시도해 주세요.'); return;
        }
        timer = window.setTimeout(poll, 3000);
      } catch (error) {
        if (controller.signal.aborted) return;
        setDeviceAuth((current) => current ? { ...current, status: 'error' } : current);
        setMessage(error instanceof Error ? error.message : '로그인 상태를 확인하지 못했어요.');
      }
    };
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [deviceAuth?.status]);
  const [activeView, setActiveView] = useState<'studio' | 'results'>('studio');
  const [openedResultFolder, setOpenedResultFolder] = useState<string | null>(null);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [boardDrag, setBoardDrag] = useState<{ pointerX: number; pointerY: number; panX: number; panY: number } | null>(null);  const [showNodePalette, setShowNodePalette] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [panelTab, setPanelTab] = useState<'create' | 'configure' | 'library'>('create');
  const [editDraft, setEditDraft] = useState<FlowEditDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [editUndo, setEditUndo] = useState<{ before: EditSnapshot<StudioNode>; after: EditSnapshot<StudioNode> } | null>(null);
  useEffect(() => { setEditDraft(null); setEditUndo(null); }, [currentProjectId]);
  useEffect(() => { if (selected !== null || selectedGroup) setPanelTab('configure'); }, [selected, selectedGroup]);
  useEffect(() => {
    try { setTemplates(parseTemplates(JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) || '[]'))); }
    catch { setMessage('저장된 템플릿을 읽지 못했어요. 브라우저 저장 내용을 확인해 주세요.'); }
  }, []);

  useEffect(() => {
    const connect = () => {
      if (executionRef.current || planningRef.current) return;
      localBridgeFetch('/status', { signal: AbortSignal.timeout(20000) }).then(response => response.json()).then(data => setStatus(data.bridge ? (data.authenticated ? '연결됨' : '계정 연결 필요') : '연결 준비 중')).catch(() => setStatus('연결 준비 중'));
    };
    connect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = initialProjectId ? localStorage.getItem(`gpt-node-studio-project-${initialProjectId}`) : localStorage.getItem('gpt-node-studio-workflow-v2') || localStorage.getItem('gpt-node-studio-workflow-v1');
        const storedProjects = JSON.parse(localStorage.getItem('gpt-node-studio-projects-v1') || '[]') as SavedProject[];
        if (Array.isArray(storedProjects)) setProjects(storedProjects);
        const parsed = saved ? JSON.parse(saved) as { projectId?: string; imageStorageVersion?: number; projectName?: string; nodes?: StudioNode[]; groups?: StudioGroup[]; edges?: Edge[]; request?: string; imageUrl?: string; imageName?: string; history?: ImageHistoryEntry[] } : {};
        const restoredProjectId = initialProjectId || parsed.projectId || 'default';
        const loadedNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
        const loadedHistory = Array.isArray(parsed.history) ? parsed.history.slice(0, HISTORY_LIMIT) : [];
        const records = nodeImageRecords(loadedNodes);
        if (parsed.imageUrl) records.push({ key: 'global', url: parsed.imageUrl });
        if (records.length) await saveImageRecords(records, restoredProjectId);
        const imageMap = await loadImageRecords(['global', ...imageRecordKeys(loadedNodes), ...loadedHistory.map((entry) => `history:${entry.id}`)], restoredProjectId, Boolean(saved) && parsed.imageStorageVersion !== 2);
        const restoredNodes = restoreNodeImages(normalizeNodes(loadedNodes), imageMap);
        if (cancelled) return;
        setNodes(restoredNodes);
        setGroups(parseGroups(parsed.groups, restoredNodes, parsed.edges || []));
        if (Array.isArray(parsed.edges)) setEdges(parsed.edges);
        if (typeof parsed.request === 'string') setRequest(parsed.request);
        if (imageMap.global) setImageUrl(imageMap.global);
        if (loadedHistory.length) setHistory(loadedHistory.map((entry) => ({ ...entry, url: imageMap[`history:${entry.id}`] || '' })).filter((entry) => entry.url));
        setCurrentProjectId(restoredProjectId);
        if (typeof parsed.projectName === 'string' && parsed.projectName.trim()) setProjectName(parsed.projectName.trim());
        if (typeof parsed.imageName === 'string') setImageName(parsed.imageName);
        setLastSavedAt(new Date().toISOString());
        if (restoredNodes.length) setMessage('저장된 프로젝트와 이미지를 불러왔어요.');
        setHydrated(true);
      } catch {
        if (!cancelled) { setMessage('저장된 작업을 읽지 못했어요. 기존 저장 내용을 보존했어요. 다시 불러오거나 새 프로젝트로 시작해 주세요.'); setHydrationFailed(true); }
      }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const metadataNodes = imageMetadata(nodes);
    const imageRecords = nodeImageRecords(nodes);
    imageRecords.push({ key: 'global', url: imageUrl });
    history.forEach((entry) => imageRecords.push({ key: `history:${entry.id}`, url: entry.url }));
    const snapshot = { projectId: currentProjectId, imageStorageVersion: 2, projectName: projectName.trim() || '빈 작업실', nodes: metadataNodes, groups, edges, request, imageName, history: history.map(({ url: _url, ...entry }) => entry) };
    pendingSave.current = async () => {
      await saveImageRecords(imageRecords, currentProjectId);
      if (activeWorkspace.current) localStorage.setItem('gpt-node-studio-workflow-v2', JSON.stringify(snapshot));
      localStorage.setItem(`gpt-node-studio-project-${currentProjectId}`, JSON.stringify(snapshot));
    };
    const timer = window.setTimeout(() => {
      void flushStorage().catch(() => setMessage('프로젝트를 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.'));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [hydrated, nodes, groups, edges, request, imageUrl, imageName, history, projectName, currentProjectId, active]);


  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const dx = (event.clientX - drag.pointerX) / canvasZoom;
      const dy = (event.clientY - drag.pointerY) / canvasZoom;
      setNodes((current) => current.map((node) => node.id === drag.id ? { ...node, x: Math.max(8, drag.nodeX + dx), y: Math.max(8, drag.nodeY + dy) } : node));
    };
    const stop = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
  }, [drag, canvasZoom]);

  useEffect(() => {
    if (!boardDrag) return;
    const move = (event: PointerEvent) => setCanvasPan({ x: boardDrag.panX + event.clientX - boardDrag.pointerX, y: boardDrag.panY + event.clientY - boardDrag.pointerY });
    const stop = () => setBoardDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
  }, [boardDrag]);


  useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if (event.key !== 'Delete' && event.key !== 'Backspace') return; const target = event.target as HTMLElement | null; if (target?.closest('input, textarea, select, [contenteditable="true"]')) return; if (!activeWorkspace.current || selected === null || nodeBusy(selected) || planningRef.current) return; event.preventDefault(); setNodes((current) => current.filter((node) => node.id !== selected)); setEdges((current) => current.filter((edge) => edge.source !== selected && edge.target !== selected)); setActiveNodeIds((current) => current.filter((id) => id !== selected)); setSelected(null); setConnectSource(null); setMessage('선택한 노드를 삭제했어요'); }; window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown); }, [selected]);

  useEffect(() => {
    setGroups(current => current.filter(group => nodes.some(node => node.groupId === group.id)).length === current.length ? current : current.filter(group => nodes.some(node => node.groupId === group.id)));
    setSelectionIds(current => current.every(id => nodes.some(node => node.id === id)) ? current : current.filter(id => nodes.some(node => node.id === id)));
  }, [nodes]);
  useEffect(() => {
    if (!groupDrag) return;
    const minX = Math.min(...groupDrag.positions.map(position => position.x));
    const minY = Math.min(...groupDrag.positions.map(position => position.y));
    const move = (event: PointerEvent) => {
      const dx = Math.max(28 - minX, (event.clientX - groupDrag.pointerX) / canvasZoom);
      const dy = Math.max(70 - minY, (event.clientY - groupDrag.pointerY) / canvasZoom);
      setNodes(current => current.map(node => {
        const position = groupDrag.positions.find(item => item.id === node.id);
        return position ? { ...node, x: position.x + dx, y: position.y + dy } : node;
      }));
    };
    const stop = () => setGroupDrag(null);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
  }, [groupDrag, canvasZoom]);
  const createNodeGroup = () => {
    if (executionRef.current || planningRef.current) return;
    const ids = expandedGroupIds(nodes, edges, selectionIds.length ? selectionIds : selected === null ? [] : [selected]);
    if (!ids.size) return;
    const touched = new Set(nodes.filter(node => ids.has(node.id) && node.groupId).map(node => node.groupId));
    nodes.filter(node => node.groupId && touched.has(node.groupId)).forEach(node => ids.add(node.id));
    const id = crypto.randomUUID();
    setNodes(current => current.map(node => ids.has(node.id) ? { ...node, groupId: id } : node));
    setGroups(current => [...current.filter(group => !touched.has(group.id)), { id, name: `그룹 ${current.length + 1}` }]);
    setSelectedGroup(id); setSelected(null); setSelectionIds([]); setMessage('연결된 체인을 그룹으로 묶었어요.');
  };
  const fitCanvas = () => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box || !nodes.length) { setCanvasZoom(1); setCanvasPan({ x: 0, y: 0 }); return; }
    const bounds = groupBounds(nodes);
    const zoom = Math.min(1, Math.max(.15, Math.min((box.width - 48) / bounds.width, (box.height - 80) / bounds.height)));
    setCanvasZoom(zoom); setCanvasPan({ x: 24 - bounds.x * zoom, y: 56 - bounds.y * zoom });
  };
  const appendBatchFiles = async (nodeId: number, files: File[]) => {
    if (nodeBusy(nodeId) || planningRef.current || !files.length) return;
    const node = nodes.find(item => item.id === nodeId); if (!node?.images) return;
    if (node.images.length + files.length > 12 || files.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 32 * 1024 * 1024)) { setMessage('입력당 최대 12장, 파일당 32MB 이하의 PNG/JPG/WEBP를 선택해 주세요.'); return; }
    const controller = new AbortController(); planningRef.current = controller; setPlanning(true); setUploading(true);
    try {
      const added: StudioImage[] = [];
      for (const file of files) { controller.signal.throwIfAborted(); added.push({ id: crypto.randomUUID(), name: file.name, url: await optimizeImageDataUrl(file) }); }
      controller.signal.throwIfAborted();
      setNodes(current => current.map(item => { if (item.id !== nodeId) return item; const images = [...(item.images || []), ...added]; return { ...item, images, imageUrl: images[0]?.url, imageName: `${images.length}장 입력` }; }));
      if (!executionRef.current) setBatchTasks([]); setMessage(`${added.length}장을 같은 입력에 추가했어요. 노드는 늘어나지 않아요.`);
    } catch (error) { setMessage(controller.signal.aborted ? '사진 추가를 취소했어요.' : error instanceof Error ? error.message : '사진을 읽지 못했어요.'); }
    finally { planningRef.current = null; setPlanning(false); setUploading(false); }
  };
  const removeBatchImage = (nodeId: number, imageId: string) => {
    if (nodeBusy(nodeId) || planningRef.current) return;
    setNodes(current => current.map(node => { if (node.id !== nodeId) return node; const images = (node.images || []).filter(image => image.id !== imageId); return { ...node, images, imageUrl: images[0]?.url, imageName: `${images.length}장 입력` }; }));
    if (!executionRef.current) setBatchTasks([]); setMessage('입력에서 사진을 뺐어요. 보관한 결과는 유지돼요.');
  };
  const setBatchOutput = (nodeId: number, output: BatchOutput) => {
    if (nodeBusy(nodeId) || planningRef.current) return;
    setNodes(current => current.map(node => node.id === nodeId ? { ...node, batchOutput: output } : node));
    setMessage(output === 'sheet' ? '선택한 결과들을 한 장에 배치합니다.' : '사진마다 개별 PNG를 만들고 작업 폴더로 저장합니다.');
  };
  const canAssembleBatch = (input: StudioNode) => {
    const previews = workflowGroups(nodes, edges, input.id).flat().filter(node => node.type === 'preview').map(node => nodes.find(item => item.id === node.id));
    return Boolean(input.images?.length && previews.length && previews.every(node => input.images?.every(image => node?.images?.some(result => result.id === image.id))));
  };
  const assembleStoredBatch = async (input: StudioNode) => {
    if (executionRef.current || planningRef.current || !input.images?.length) return;
    const controller = new AbortController(); planningRef.current = controller; setPlanning(true);
    try {
      const chains = workflowGroups(nodes, edges, input.id).map(chain => chain.map(node => nodes.find(item => item.id === node.id)).filter((node): node is StudioNode => Boolean(node)));
      const jobs = await sharedJobs(chains, edges, request);
      controller.signal.throwIfAborted();
      for (const preview of chains.flat().filter(node => node.type === 'preview')) {
        if (preview.batchSignature !== jobs[0]?.signature) throw new WorkflowExecutionError('입력이나 공통 처리 설정이 바뀌었어요. 플로우를 다시 실행해 주세요.');
        const images = input.images.map(image => preview.images?.find(result => result.id === image.id));
        if (images.some(image => !image?.url)) throw new WorkflowExecutionError('모든 사진의 누끼 결과가 필요해요. 실패한 사진을 먼저 다시 실행해 주세요.');
        const complete = images.filter((image): image is StudioImage => Boolean(image));
        if (input.batchOutput !== 'sheet') {
          const folder = preview.resultFolder || { id: crypto.randomUUID(), name: `${groups.find(group => group.id === input.groupId)?.name || projectName} · 결과`.slice(0,200), expectedCount: complete.length };
          complete.forEach((image,index) => addHistory(image.url, image.name, { folder, resultKey: `${preview.id}:${image.id}`, resultOrder: index }));
          setNodes(current => current.map(node => node.id === preview.id ? { ...node, images: complete, previewMode: 'each', resultFolder: folder, imageUrl: complete[0]?.url, imageName: `개별 결과 ${complete.length}장` } : node));
          setImageUrl(complete[0].url); setImageName(complete[0].name); continue;
        }
        const sheet = await composeSheet(complete.map(image => image.url), controller.signal);
        controller.signal.throwIfAborted();
        const label = `누끼 ${complete.length}장 · 한 장으로 모음`;
        setNodes(current => current.map(node => node.id === preview.id ? { ...node, imageUrl: sheet, imageName: label, previewMode: 'sheet' } : node));
        setImageUrl(sheet); setImageName(label); addHistory(sheet, label);
      }
      setMessage(input.batchOutput === 'sheet' ? '저장된 결과를 한 장에 배치했어요.' : '개별 결과들을 결과물 폴더에 저장했어요.');
    } catch (error) { setMessage(controller.signal.aborted ? '결과 구성을 취소했어요.' : error instanceof Error ? error.message : '결과를 구성하지 못했어요.'); }
    finally { planningRef.current = null; setPlanning(false); }
  };
  const compactCutoutGroup = async (groupId: string) => {
    if (executionRef.current || planningRef.current) return;
    const members = nodes.filter(node => node.groupId === groupId);
    if (members.some(node => node.images)) { setMessage('이미 공통 플로우를 사용 중이에요.'); return; }
    const memberIds = new Set(members.map(node => node.id));
    const groupEdges = edges.filter(edge => memberIds.has(edge.source) && memberIds.has(edge.target));
    const chains = workflowGroups(members, groupEdges, null);
    const commands = members.filter(node => node.type === 'command');
    if (chains.length < 2 || chains.length > 12 || commands.some(node => node.prompt !== commands[0]?.prompt) || chains.some(chain => chain.length !== 4 || ['image', 'command', 'edit', 'preview'].some(type => chain.filter(node => node.type === type).length !== 1))) { setMessage('같은 명령을 사용하는 기본 누끼 체인만 공통 플로우로 바꿀 수 있어요.'); return; }
    for (const chain of chains) {
      const ids = ['image', 'command', 'edit', 'preview'].map(type => chain.find(node => node.type === type)?.id);
      if (!ids.every((id, index) => index === 3 || groupEdges.some(edge => edge.source === id && edge.target === ids[index + 1])) || groupEdges.filter(edge => chain.some(node => node.id === edge.source)).length !== 3) { setMessage('수정된 연결이 있어요. 기존 플로우를 유지합니다.'); return; }
    }
    if (!commands[0]?.prompt?.split(/\s+/).includes('/REMOVEBG') || chains.some(chain => !chain.find(node => node.type === 'image')?.imageUrl)) { setMessage('사진이 들어 있는 누끼 그룹을 선택해 주세요.'); return; }
    const images = chains.map(chain => { const input = members.find(node => node.type === 'image' && chain.some(item => item.id === node.id)); return { id: `legacy-${input?.id}`, name: input?.imageName || '입력 사진', url: input?.imageUrl || '' }; });
    const base = Math.max(Date.now(), ...nodes.map(node => node.id + 1), ...edges.map(edge => edge.id + 1));
    const built = buildSharedCutout(images, base, groupId, Math.min(...members.map(node => node.y)));
    const converted: StudioNode[] = built.nodes.map(node => ({ ...node, ...nodeCatalog[node.type] }));
    const command = converted.find(node => node.type === 'command'); if (command) command.prompt = commands[0].prompt;
    const results = chains.flatMap((chain, index) => { const preview = members.find(node => node.type === 'preview' && chain.some(item => item.id === node.id)); return preview?.imageUrl ? [{ ...images[index], url: preview.imageUrl }] : []; });
    const controller = new AbortController(); planningRef.current = controller; setPlanning(true);
    try {
      const jobs = await sharedJobs([converted], built.edges, request);
      const preview = converted.find(node => node.type === 'preview');
      if (preview) {
        preview.images = results; preview.batchSignature = jobs[0]?.signature; preview.previewMode = 'each';
        preview.resultFolder = { id: crypto.randomUUID(), name: `${groups.find(group => group.id === groupId)?.name || projectName} · 결과`.slice(0,200), expectedCount: images.length };
        preview.imageUrl = results[0]?.url; preview.imageName = `개별 결과 ${results.length}장`;
      }
      controller.signal.throwIfAborted();
      setNodes(current => [...current.filter(node => !memberIds.has(node.id)), ...converted]);
      setEdges(current => [...current.filter(edge => !memberIds.has(edge.source) && !memberIds.has(edge.target)), ...built.edges]);
      setSelectedGroup(groupId); setSelected(null); setSelectionIds([]); setBatchTasks([]);
      if (preview?.imageUrl && preview.resultFolder) {
        setImageUrl(preview.imageUrl); setImageName(preview.imageName || '개별 결과');
        results.forEach((image,index) => addHistory(image.url, image.name, { folder: preview.resultFolder, resultKey: `${preview.id}:${image.id}`, resultOrder: index }));
      }
      setMessage(`${members.length}개 노드를 공통 플로우 4개로 줄였어요. 기존 결과도 보관했어요.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '공통 플로우로 바꾸지 못했어요.'); }
    finally { planningRef.current = null; setPlanning(false); }
  };

  const addCutoutFiles = async (files: File[]) => {
    if (executionRef.current || planningRef.current || !files.length) return;
    if (files.length > 12) { setMessage('사진은 한 번에 12장까지 선택해 주세요.'); return; }
    if (files.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 32 * 1024 * 1024)) { setMessage('32MB 이하의 PNG, JPG, WEBP 사진을 선택해 주세요.'); return; }
    const controller = new AbortController(); planningRef.current = controller; setPlanning(true); setUploading(true);
    try {
      const images: { url: string; name: string }[] = [];
      for (const file of files) { controller.signal.throwIfAborted(); images.push({ url: await optimizeImageDataUrl(file), name: file.name }); }
      controller.signal.throwIfAborted();
      const id = crypto.randomUUID();
      const base = Math.max(Date.now(), ...nodes.map(node => node.id + 1), ...edges.map(edge => edge.id + 1));
      const built = buildSharedCutout(images.map(image => ({ ...image, id: crypto.randomUUID() })), base, id, nodes.length ? Math.max(...nodes.map(node => node.y)) + 500 : 150);
      if (nodes.length + built.nodes.length > 500) throw new Error('노드는 프로젝트당 500개까지 추가할 수 있어요.');
      setNodes(current => [...current, ...built.nodes.map(node => ({ ...node, ...nodeCatalog[node.type] }))]);
      setEdges(current => [...current, ...built.edges]);
      setGroups(current => [...current, { id, name: `누끼 ${images.length}장 · ${current.length + 1}` }]);
      setSelectedGroup(id); setSelected(null); setSelectionIds([]); setBatchTasks([]); setCanvasZoom(.7);
      setCanvasPan({ x: 0, y: -(built.nodes[0].y - 150) * .7 });
      setMessage(`${images.length}장 · 공통 플로우 1개 · 개별 결과들이 한 폴더에 저장됩니다.`);
    } catch (error) { setMessage(controller.signal.aborted ? '이미지 추가를 취소했어요.' : error instanceof Error ? error.message : '이미지를 읽지 못했어요.'); }
    finally { planningRef.current = null; setPlanning(false); setUploading(false); }
  };

  const addImageToNode = async (file: File, nodeId: number) => { if (nodeBusy(nodeId) || planningRef.current) { setMessage('실행이 끝난 뒤 플로우를 변경해 주세요.'); return; } if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setMessage('PNG, JPG, WEBP 이미지 파일만 추가할 수 있어요'); return; } try { const dataUrl = await optimizeImageDataUrl(file); if (nodeBusy(nodeId) || planningRef.current) return; setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, imageUrl: dataUrl, imageName: file.name } : node)); setImageUrl(dataUrl); setImageName(file.name); setSelected(nodeId); setMessage(`${file.name}을 이미지 입력 노드에 추가했어요`); } catch { setMessage('이미지를 읽지 못했어요. 다시 선택해 주세요.'); } };
  const addUploadedImage = async (file: File) => { if (planningRef.current) { setMessage('실행이 끝난 뒤 플로우를 변경해 주세요.'); return; } if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setMessage('PNG, JPG, WEBP 이미지 파일만 추가할 수 있어요'); return; } try { const dataUrl = await optimizeImageDataUrl(file); if (planningRef.current) return; setImageUrl(dataUrl); setImageName(file.name); const id = Date.now(); setNodes((current) => [...current, { id, type: 'image', ...nodeCatalog.image, imageUrl: dataUrl, imageName: file.name, x: 70 + (current.length % 3) * 245, y: 135 + Math.floor(current.length / 3) * 180 }]); setSelected(id); setMessage(`${file.name}을 2048px 이하로 최적화해 이미지 입력으로 추가했어요`); } catch { setMessage('이미지를 읽지 못했어요. 다시 선택해 주세요.'); } };
  const reuseImage = (url: string, name: string) => { if (executionRef.current || planningRef.current) { setMessage('실행이 끝난 뒤 플로우를 변경해 주세요.'); return; } const emptyInput = nodes.find((node) => node.type === 'image' && !node.imageUrl); const id = emptyInput?.id ?? Date.now(); setImageUrl(url); setImageName(name); setNodes((current) => emptyInput ? current.map((node) => node.id === emptyInput.id ? { ...node, imageUrl: url, imageName: name } : node) : [...current, { id, type: 'image', ...nodeCatalog.image, imageUrl: url, imageName: name, x: 70 + (current.length % 3) * 245, y: 135 + Math.floor(current.length / 3) * 180 }]); setSelected(id); setMessage(`${name}을 이미지 입력으로 재사용했어요. 현재 플로우의 입력 이미지로 연결했어요.`); setViewerImage(null); };
  const reusePreview = () => { if (!imageUrl) { setMessage('먼저 이미지를 추가하거나 실행 결과를 만들어 주세요'); return; } reuseImage(imageUrl, imageName || 'PREVIEW 결과'); };

  const addHistory = (url: string, label = '생성 이미지', options?: { folder?: ResultFolder; resultKey?: string; resultOrder?: number }) => {
    const entry: ImageHistoryEntry = { id: crypto.randomUUID(), name: label, createdAt: new Date().toISOString(), url, projectId: currentProjectId, ...options };
    setHistory(current => addResult(current, entry, HISTORY_LIMIT));
  };
  const downloadResult = (image: ImageResult) => {
    const link = document.createElement('a'); link.href = image.url; link.download = imageDownloadName(image.name); link.click();
  };
  const renameResultFolder = (id: string, name: string) => {
    if (executionRef.current || planningRef.current) { setMessage('실행 후 폴더 이름을 바꿔 주세요.'); return; }
    const next = name.trim() ? name.slice(0,200) : '작업 결과';
    setHistory(current => current.map(image => image.folder?.id === id ? { ...image, folder: { ...image.folder, name: next } } : image));
    setNodes(current => current.map(node => node.resultFolder?.id === id ? { ...node, resultFolder: { ...node.resultFolder, name: next } } : node));
  };
  const runWorkflow = async (explicitGroup?: string, retryIds?: (number | string)[]) => {
    if (executionRef.current || planningRef.current) return;
    const controller = new AbortController(); executionRef.current = controller;
    const targetGroup = explicitGroup ?? selectedGroup;
    const scopeLabel = targetGroup ? groups.find(group => group.id === targetGroup)?.name || '선택 그룹' : selected === null ? '전체 워크플로우' : '선택한 워크플로우';
    try {
      const scope = retryIds ? retryIds.map(id => typeof id === 'number' ? id : Number(id.split(':')[0])) : targetGroup ? nodes.filter(node => node.groupId === targetGroup).map(node => node.id) : selected;
      const chains = workflowGroups(nodes, edges, scope).filter(chain => chain.some(node => node.type === 'image' || node.type === 'generate')).map(chain => chain.map(node => nodes.find(item => item.id === node.id)).filter((node): node is StudioNode => Boolean(node)));
      const runnable = chains.filter(chain => retryIds || !targetGroup || chain.some(node => nodes.find(item => item.id === node.id)?.groupId === targetGroup));
      if (!runnable.length) throw new WorkflowExecutionError('실행할 이미지 워크플로우가 없어요.');
      const scopedEdges = (chain: readonly { id: number }[]) => edges.filter(edge => chain.some(node => node.id === edge.source) && chain.some(node => node.id === edge.target));
      for (const chain of runnable) validateWorkflow(chain, scopedEdges(chain), request);
      runningNodeIds.current = new Set(runnable.flatMap(chain => chain.map(node => node.id)));
      const allJobs = await sharedJobs(runnable, edges, request);
      const jobs = allJobs.filter(job => !retryIds || retryIds.includes(job.id));
      if (retryIds && jobs.some(job => job.source && job.nodes.some(node => node.type === 'preview' && node.images?.length && node.batchSignature !== job.signature))) throw new WorkflowExecutionError('입력이나 처리 설정이 변경됐어요. 전체 플로우를 다시 실행해 주세요.');
      if (!jobs.length) throw new WorkflowExecutionError('다시 실행할 사진이 없어요.');
      const folders = new Map<number, ResultFolder>();
      for (const job of allJobs) {
        if (!job.source || job.inputId === undefined || folders.has(job.inputId)) continue;
        const previews = job.nodes.filter(node => node.type === 'preview');
        const previous = previews.find(node => node.resultFolder && node.batchSignature === job.signature)?.resultFolder;
        const input = nodes.find(node => node.id === job.inputId);
        const photoCount = allJobs.filter(item => item.inputId === job.inputId).length;
        folders.set(job.inputId, retryIds && previous ? previous : { id: crypto.randomUUID(), name: `${groups.find(group => group.id === input?.groupId)?.name || scopeLabel} · 결과`.slice(0,200), expectedCount: photoCount * previews.length });
      }
      const tasks = jobs.map(job => ({ id: job.id, name: job.source?.name || nodes.find(node => job.nodes.some(item => item.id === node.id) && node.type === 'image')?.imageName || job.name, status: 'waiting' as const }));
      const cached = new Map<number, StudioImage[]>();
      for (const job of allJobs) if (job.source) for (const node of job.nodes.filter(node => node.type === 'preview')) {
        if (!cached.has(node.id)) cached.set(node.id, retryIds && node.batchSignature === job.signature ? [...(node.images || [])] : []);
      }
      setBatchTasks(tasks); setRunState('running'); setRunLabel('처리 중');
      const previewIds = new Set(jobs.flatMap(job => job.nodes.filter(node => node.type === 'preview').map(node => node.id)));
      setNodes(current => current.map(node => previewIds.has(node.id) ? { ...node, imageUrl: undefined } : node));
      const totalRequests = jobs.reduce((total, job) => total + estimateRequests(job.nodes), 0); let sentRequests = 0;
      setRunMetrics({ requested: 0, total: totalRequests, completed: 0, failed: 0, stage: '입력 이미지를 확인했어요' });
      const activeJobs = new Map<number | string, number>();
      const outcomes = await runBatch({
        items: jobs, controller, concurrency: 2,
        isFatal: error => error instanceof WorkflowExecutionError && ['authentication_required', 'provider_rate_limited', 'provider_plan_rate_limited'].includes(error.code),
        onOutcome: outcome => {
          const task = tasks[outcome.index];
          setBatchTasks(current => current.map(item => item.id === task.id ? { ...item, status: outcome.status, message: outcome.message } : item));
          if (outcome.status === 'done' || outcome.status === 'error') setRunMetrics(current => ({ ...current, completed: current.completed + (outcome.status === 'done' ? 1 : 0), failed: current.failed + (outcome.status === 'error' ? 1 : 0), stage: outcome.status === 'done' ? '결과를 확인하고 있어요' : '일부 작업을 확인해 주세요' }));
        },
        execute: async (job, index) => {
          const chain = job.nodes;
          const task = tasks[index];
          setBatchTasks(current => current.map(item => item.id === task.id ? { ...item, status: 'running' } : item));
          try {
            await executeWorkflow({
              nodes: chain, edges: scopedEdges(chain), request, normalizeImage: optimizeImageDataUrl,
              onNodeStart: node => { controller.signal.throwIfAborted(); activeJobs.set(task.id, node.id); setActiveNodeIds([...new Set(activeJobs.values())]); },
              onPreview: (node, image) => {
                controller.signal.throwIfAborted();
                setRunMetrics(current => ({ ...current, stage: '결과 미리보기를 준비하고 있어요' }));
                const label = `${task.name} · 결과`;
                if (job.source) {
                  const result = { ...job.source, url: image };
                  const values = [...(cached.get(node.id) || []).filter(value => value.id !== result.id), result];
                  cached.set(node.id, values);
                  setNodes(current => current.map(item => item.id === node.id ? { ...item, images: values, batchSignature: job.signature, imageUrl: image, imageName: `${values.length}장 개별 결과`, previewMode: job.output, resultFolder: job.inputId === undefined ? undefined : folders.get(job.inputId) } : item));
                } else setNodes(current => current.map(item => item.id === node.id ? { ...item, imageUrl: image, imageName: label } : item));
                setImageUrl(image); setImageName(label);
                if (!job.source) addHistory(image, label);
                else if (job.output !== 'sheet' && job.inputId !== undefined) {
                  const batch = allJobs.filter(item => item.inputId === job.inputId);
                  const previews = chain.filter(item => item.type === 'preview');
                  const order = batch.findIndex(item => item.id === job.id) * previews.length + previews.findIndex(item => item.id === node.id);
                  addHistory(image, job.source.name, { folder: folders.get(job.inputId), resultKey: `${node.id}:${job.source.id}`, resultOrder: order });
                }
              },
              encodeAnimation: encodeGif, encodeApng, splitMotionAtlas,
              execute: async stage => {
                controller.signal.throwIfAborted(); sentRequests += 1;
                setRunMetrics(current => ({ ...current, requested: sentRequests, stage: '이미지를 만드는 중이에요' }));
                setRunProgress(`이미지 요청 ${sentRequests} / ${totalRequests} · 최대 2장 동시 처리`);
                const response = await localBridgeFetch(stage.kind === 'edit' ? '/v1/edit' : '/v1/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stage), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(245000)]) });
                const data: unknown = await response.json();
                if (typeof data !== 'object' || data === null) throw new WorkflowExecutionError('이미지 실행 응답을 읽지 못했어요.', 'bridge_invalid_response');
                const code = 'error' in data && typeof data.error === 'string' ? data.error : 'image_execution_failed';
                if (response.status === 401) throw new WorkflowExecutionError('계정 연결이 필요해요.', 'authentication_required');
                if (response.status === 429) throw new WorkflowExecutionError('요청 한도에 도달했어요. 잠시 후 실패한 사진을 다시 실행해 주세요.', 'provider_rate_limited');
                if (!response.ok) throw new WorkflowExecutionError('message' in data && typeof data.message === 'string' ? data.message : '이미지 실행에 실패했어요.', code);
                if (!('imageUrl' in data) || typeof data.imageUrl !== 'string' || !data.imageUrl) throw new WorkflowExecutionError('provider가 결과 이미지를 반환하지 않았어요.', 'provider_result_invalid');
                return data.imageUrl;
              },
            });
          } finally { activeJobs.delete(task.id); setActiveNodeIds([...new Set(activeJobs.values())]); }
        },
      });
      for (const [previewId, results] of cached) {
        const batch = allJobs.filter(job => job.source && job.nodes.some(node => node.id === previewId));
        if (!batch.length) continue;
        if (batch[0].output !== 'sheet') {
          const folder = batch[0].inputId === undefined ? undefined : folders.get(batch[0].inputId);
          const previews = batch[0].nodes.filter(node => node.type === 'preview');
          const previewIndex = previews.findIndex(node => node.id === previewId);
          if (folder) batch.forEach((job,index) => {
            const result = results.find(image => image.id === job.source?.id);
            if (result) addHistory(result.url, result.name, { folder, resultKey: `${previewId}:${result.id}`, resultOrder: index * previews.length + previewIndex });
          });
          const orderedResults = batch.map(job => results.find(image => image.id === job.source?.id)).filter((image): image is StudioImage => Boolean(image));
          if (orderedResults.length) setNodes(current => current.map(node => node.id === previewId ? { ...node, images: orderedResults, imageUrl: orderedResults[0].url, previewMode: 'each', resultFolder: folder, imageName: `개별 결과 ${orderedResults.length}장` } : node));
          continue;
        }
        const ordered = batch.map(job => results.find(result => result.id === job.source?.id));
        if (ordered.some(image => !image)) continue;
        const complete = ordered.filter((image): image is StudioImage => Boolean(image));
        controller.signal.throwIfAborted();
        const sheet = await composeSheet(complete.map(image => image.url), controller.signal);
        controller.signal.throwIfAborted();
        const label = `누끼 ${complete.length}장 · 한 장으로 모음`;
        setNodes(current => current.map(node => node.id === previewId ? { ...node, imageUrl: sheet, imageName: label, images: complete, previewMode: 'sheet' } : node));
        setImageUrl(sheet); setImageName(label); addHistory(sheet, label);
      }
      const done = outcomes.filter(item => item.status === 'done').length;
      const failed = outcomes.length - done;
      setRunState(failed ? 'error' : 'done'); setRunLabel(`${failed ? '일부 실패' : '완료'} · ${scopeLabel}`);
      setRunMetrics(current => ({ ...current, stage: failed ? '실패한 작업을 확인해 주세요' : '모든 결과를 준비했어요' }));
      setMessage(`${done}개 이미지 작업 완료${failed ? ` · ${failed}개 실패 · 성공 결과는 보관했어요` : ''}`);
    } catch (error) {
      setBatchTasks(current => current.map(task => ['waiting', 'running'].includes(task.status) ? { ...task, status: 'error', message: controller.signal.aborted ? '취소 또는 실행 중단' : '실행하지 못했어요' } : task));
      if (error instanceof WorkflowExecutionError && error.code === 'authentication_required') { setRunState('idle'); setRunLabel('로그인 필요'); await startLogin(); }
      else { setRunState(controller.signal.aborted && !(error instanceof WorkflowExecutionError) ? 'idle' : 'error'); setRunLabel(controller.signal.aborted ? '실행 중단' : `실패 · ${scopeLabel}`); setMessage(error instanceof WorkflowExecutionError ? error.message : controller.signal.aborted ? '작업 실행을 취소했어요. 완료된 결과는 보관했어요.' : error instanceof Error ? error.message : '이미지 실행에 실패했어요.'); }
    } finally { executionRef.current = null; runningNodeIds.current = new Set(); setActiveNodeIds([]); setRunProgress(''); }
  };

  const startLogin = async () => {
    setDeviceAuth({ userCode: '코드 준비 중', verificationUrl: '', status: 'preparing' });
    setMessage('계정 연결 코드를 준비 중이에요');
    try {
      const response = await localBridgeFetch('/auth/device/start', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '계정 연결을 시작할 수 없어요');
      const userCode = data.userCode || '코드 준비 중';
      setDeviceAuth({ userCode, verificationUrl: data.verificationUrl || '', status: 'waiting' });
      setMessage(`인증 화면에서 코드 ${userCode}를 입력하세요`);
    } catch (error) {
      setDeviceAuth((current) => current ? { ...current, status: 'error' } : current);
      setMessage(error instanceof Error ? error.message : '계정 연결을 시작할 수 없어요');
    }
  };

  const appendCommand = (nodeId: number, code: string) => { if (nodeBusy(nodeId) || planningRef.current) return; setNodes((current) => current.map((item) => { if (item.id !== nodeId) return item; const existing = item.prompt?.trim() || ''; const token = `/${code}`; if (existing.split(/\s+/).includes(token)) return item; return { ...item, prompt: `${existing ? `${existing} ` : ''}${token}` }; })); };
  const removeCommand = (nodeId: number, code: string) => { if (nodeBusy(nodeId) || planningRef.current) return; const token = `/${code}`; setNodes((current) => current.map((item) => item.id === nodeId ? { ...item, prompt: (item.prompt || '').split(/\s+/).filter((part) => part !== token).join(' ').trim() } : item)); };
  const duplicateNode = () => { if (planningRef.current) { setMessage('실행이 끝난 뒤 플로우를 변경해 주세요.'); return; } if (selected === null) { setMessage('먼저 복제할 노드를 선택해 주세요'); return; } const source = nodes.find((node) => node.id === selected); if (!source) return; const id = createUniqueId(nodes.map((node) => node.id)); const copy = { ...source, groupId: undefined, id, x: source.x + 42, y: source.y + 42 }; setNodes((current) => [...current, copy]); setSelected(id); setConnectSource(null); setMessage(`${source.title} 노드를 복제했어요. 연결선은 새로 연결해 주세요.`); };
  useEffect(() => { const onDuplicate = (event: KeyboardEvent) => { if (!activeWorkspace.current) return; if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'd') return; const target = event.target as HTMLElement | null; if (target?.closest('input, textarea, select, [contenteditable="true"]')) return; if (selected === null) return; event.preventDefault(); duplicateNode(); }; window.addEventListener('keydown', onDuplicate); return () => window.removeEventListener('keydown', onDuplicate); }, [selected, nodes]);
  const getCommandTokens = (prompt = '') => prompt.split(/\s+/).filter((part) => /^\/[A-Z0-9]+$/.test(part)).map((part) => part.slice(1));
  const addNode = (type: NodeType) => { if (planningRef.current) { setMessage('실행이 끝난 뒤 플로우를 변경해 주세요.'); return; } const item = nodeCatalog[type]; const id = createUniqueId(nodes.map((node) => node.id)); setNodes((current) => [...current, { id, type, ...item, prompt: undefined, x: 70 + (current.length % 3) * 245, y: 135 + Math.floor(current.length / 3) * 180 }]); setSelected(id); if (type === 'edit') { setPanelTab('configure'); setShowNodePalette(false); } setMessage(`${item.title} 노드를 추가했어요. ${type === 'prompt' ? '프롬프트를 직접 입력해 주세요.' : ''}`); };
  const connect = (target: number) => { if (nodeBusy(connectSource) || nodeBusy(target) || planningRef.current) { setMessage('실행이 끝난 뒤 플로우를 변경해 주세요.'); return; } if (connectSource === null || connectSource === target) { setMessage('출력 포트를 먼저 선택한 뒤 다른 노드의 입력 포트를 선택하세요'); return; } if (nodes.find(node => node.id === connectSource)?.groupId !== nodes.find(node => node.id === target)?.groupId) { setMessage('다른 그룹을 연결하려면 먼저 그룹을 해제해 주세요.'); return; } if (edges.some((edge) => edge.source === connectSource && edge.target === target)) { setMessage('이미 연결된 노드예요'); return; } setEdges((current) => [...current, { id: Date.now(), source: connectSource, target }]); setConnectSource(null); setMessage('노드를 연결했어요'); };
  const plan = async () => {
    if (planningRef.current || uploading) { setMessage('이미지 준비와 플로우 구성이 끝난 뒤 구성해 주세요.'); return; }
    if (!request.trim()) { setMessage('먼저 만들고 싶은 작업을 입력해 주세요'); return; }
    const controller = new AbortController();
    planningRef.current = controller; setPlanning(true); setMessage('사진과 스타일을 반영해 세부 작업을 구성하고 있어요');
    try {
      const sources = planningSources(toolScope);
      const prompt = planningPrompt(request, { images: sources, scope: toolScopeName, style: scopeStyle?.commonStyle, output: batchInput?.batchOutput });
      const response = await localBridgeFetch('/v1/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(125000)]) });
      const data = await response.json();
      controller.signal.throwIfAborted();
      if (!response.ok) {
        if (response.status === 401) { await startLogin(); return; }
        throw new Error(data.message || '작업 흐름을 구성할 수 없어요');
      }
      const id = crypto.randomUUID(), base = Math.max(Date.now(), ...nodes.map(node => node.id + 1), ...edges.map(edge => edge.id + 1));
      const built = materializePlan(data, sources, { base, groupId: id, y: nodes.length ? Math.max(...nodes.map(node => node.y)) + 500 : 150, output: batchInput?.batchOutput });
      insertToolFlow(built, id, `${built.name}${sources.length ? ` · ${sources.length}장` : ''}`);
      if (!executionRef.current) setRunProgress(built.summary);
      setMessage(`세부 작업 ${built.nodes.length}개를 새 그룹으로 추가했어요 · 예상 이미지 요청 ${built.requests}회${built.missing ? ' · 입력 사진을 추가해 주세요' : ''}${built.warnings.length ? ' · ' + built.warnings.join(' ') : ''}`);
    } catch (error) {
      if (controller.signal.aborted) { setMessage('작업 순서 구성을 취소했어요.'); return; }
      if (!executionRef.current) { setRunState('error'); setRunLabel('구성 실패'); setRunProgress(''); }
      setMessage(error instanceof Error ? error.message : '작업 흐름 구성에 실패했어요');
    } finally { planningRef.current = null; setPlanning(false); }
  };
  const applyPreset = (preset: PresetDefinition) => { if (planningRef.current) { setMessage('실행이 끝난 뒤 플로우를 변경해 주세요.'); return; } const built = preset.build(createUniqueId([...nodes.map(node => node.id), ...edges.map(edge => edge.id)])); if (executionRef.current) { const id = crypto.randomUUID(); insertToolFlow({ nodes: built.nodes.map(node => ({ ...node, groupId: id })), edges: built.edges }, id, preset.title); setRequest(preset.request); setMessage(`${preset.title} 플로우를 새 그룹으로 추가했어요. 기존 실행은 계속돼요.`); return; } setGroups([]); setSelectedGroup(null); setSelectionIds([]); setBatchTasks([]); setNodes(built.nodes); setEdges(built.edges); setRequest(preset.request); setSelected(null); setConnectSource(null); setActiveNodeIds([]); setRunState('idle'); setRunLabel('실행 대기'); setRunProgress(''); setImageUrl(''); setImageName(''); setMessage(`${preset.title} 프리셋을 불러왔어요. 이미지 입력이 필요한 경우 이미지 입력을 교체해 주세요.`); };
  const resetFlow = () => { if (executionRef.current || planningRef.current) { setMessage('실행이 끝난 뒤 프로젝트를 변경해 주세요.'); return; } setNodes([]); setGroups([]); setSelectedGroup(null); setSelectionIds([]); setBatchTasks([]); setEdges([]); setRequest(''); setSelected(null); setConnectSource(null); setActiveNodeIds([]); setRunState('idle'); setRunLabel('실행 대기'); setRunProgress(''); setLastSavedAt(null); setMessage('플로우를 초기화했어요. 이미지는 그대로 보관돼요.'); };
  const reset = resetFlow;
  const clearImages = async () => { if (executionRef.current || planningRef.current) { setMessage('실행이 끝난 뒤 이미지를 삭제해 주세요.'); return; } if (!window.confirm('현재 입력 이미지와 생성 결과를 삭제할까요?')) return; const keys = ['global', ...imageRecordKeys(nodes), ...history.map((entry) => `history:${entry.id}`)]; try { await storageQueue.current; await deleteImageRecords(keys, currentProjectId); } catch { setMessage('이미지 저장소를 정리하지 못했어요'); return; } setNodes((current) => current.map((node) => node.type === 'image' || node.type === 'preview' ? { ...node, imageUrl: undefined, imageName: undefined, images: node.images ? [] : undefined, batchSignature: undefined } : node)); setImageUrl(''); setImageName(''); setHistory([]); setOpenedResultFolder(null); setViewerImage(null); setMessage('입력 이미지와 생성 결과를 삭제했어요'); };
  const deleteProject = async (project = { id: currentProjectId, name: projectName }) => {
    if (navigation?.isBusy(project.id)) { setMessage('작업 중인 프로젝트는 완료 후 삭제해 주세요.'); return; }
    if (executionRef.current || planningRef.current || !hydrated) return;
    if (!window.confirm(`“${project.name || '빈 작업실'}” 프로젝트를 삭제할까요? 저장된 플로우와 이미지가 삭제돼요.`)) return;
    await withProjectTransition(async () => {
      await deleteProjectImageRecords(project.id);
      localStorage.removeItem(`gpt-node-studio-project-${project.id}`);
      const nextProjects = projects.filter(item => item.id !== project.id);
      localStorage.setItem('gpt-node-studio-projects-v1', JSON.stringify(nextProjects));
      setProjects(nextProjects);
      navigation?.deleted(project.id);
      if (project.id === currentProjectId) {
        localStorage.removeItem('gpt-node-studio-workflow-v2');
        resetProject();
      }
      setMessage('프로젝트를 삭제했어요');
    });
  };
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selected) ?? null, [nodes, selected]);
  const compactableGroupIds = groups.filter(group => {
    const members = nodes.filter(node => node.groupId === group.id);
    const commands = members.filter(node => node.type === 'command');
    return members.filter(node => node.type === 'image').length > 1 && !members.some(node => node.images !== undefined) && commands.length > 0 && commands.every(node => node.prompt?.split(/\s+/).includes('/REMOVEBG'));
  }).map(group => group.id);
  const batchInput = useMemo(() => {
    try { return nodes.find(node => node.type === 'image' && node.images && ((!selectedGroup && selected === null && nodes.filter(item => item.type === 'image' && item.images !== undefined).length === 1) || node.id === selected || (selectedGroup && node.groupId === selectedGroup) || (!selectedGroup && selected !== null && workflowGroups(nodes, edges, selected).flat().some(item => item.id === node.id)))); }
    catch { return undefined; }
  }, [nodes, edges, selectedGroup, selected]);
  const toolScope = useMemo(() => {
    if (selectedGroup) return nodes.filter(node => node.groupId === selectedGroup);
    if (selected === null) return nodes;
    try { const ids = new Set(workflowGroups(nodes, edges, selected).flat().map(node => node.id)); return nodes.filter(node => ids.has(node.id)); }
    catch { return []; }
  }, [nodes, edges, selectedGroup, selected]);
  const toolScopeName = selectedGroup ? groups.find(group => group.id === selectedGroup)?.name || '선택 그룹' : selected === null ? '전체 작업' : '선택한 플로우';
  const toolScopeBusy = planning || toolScope.some(node => nodeBusy(node.id));
  const editScope = useMemo(() => {
    if (selectedGroup || selected !== null) return toolScope;
    try { return workflowGroups(nodes, edges, null).length === 1 ? toolScope : []; }
    catch { return []; }
  }, [nodes, edges, selectedGroup, selected, toolScope]);
  const editIds = new Set(editScope.map(node => node.id));
  const canEditFlow = editScope.length > 0 && editScope.length <= 64 && new Set(editScope.map(node => node.groupId)).size <= 1 && !edges.some(edge => editIds.has(edge.source) !== editIds.has(edge.target));
  const canUndoEdit = Boolean(editUndo && snapshotMatches(editUndo.after, currentProjectId, { nodes, edges, request }));
  const requestFlowEdit = async (instruction: string) => {
    if (executionRef.current || planningRef.current || uploading || editDraft) return;
    const controller = new AbortController();
    planningRef.current = controller; setPlanning(true); setEditing(true); setMessage('기존 플로우를 읽고 수정안을 구성하고 있어요');
    try {
      const snapshot = snapshotFlow(currentProjectId, { nodes, edges, request }, editScope.map(node => node.id));
      const prompt = editingPrompt(instruction, snapshot, toolScopeName);
      const response = await localBridgeFetch('/v1/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(125000)]) });
      const value: unknown = await response.json();
      controller.signal.throwIfAborted();
      if (!response.ok) {
        if (response.status === 401) { await startLogin(); return; }
        const message: unknown = value && typeof value === 'object' ? Reflect.get(value, 'message') : undefined;
        throw new Error(typeof message === 'string' ? message : '플로우 수정안을 구성하지 못했어요.');
      }
      const base = Math.max(Date.now(), ...nodes.map(node => node.id + 1), ...edges.map(edge => edge.id + 1));
      const built = prepareFlowEdit(value, snapshot, base);
      setEditDraft({ snapshot, built, instruction, scope: toolScopeName });
      setMessage('수정안을 확인하고 적용해 주세요. 기존 플로우는 아직 변경되지 않았어요.');
    } catch (error) {
      if (controller.signal.aborted) { setMessage('플로우 수정 요청을 취소했어요. 기존 작업은 유지돼요.'); return; }
      setMessage(error instanceof Error ? error.message : '플로우 수정안 구성에 실패했어요.');
    } finally { planningRef.current = null; setPlanning(false); setEditing(false); }
  };
  const applyFlowEdit = () => {
    if (!editDraft || executionRef.current || planningRef.current || uploading) return;
    try {
      const applied: StudioNode[] = editDraft.built.nodes.map(node => ({ ...node, ...nodeCatalog[node.type], title: node.taskTitle || nodeCatalog[node.type].title, subtitle: node.taskDetail || nodeCatalog[node.type].subtitle }));
      const next = replaceFlow(editDraft.snapshot, { nodes: applied, edges: editDraft.built.edges, request }, { projectId: currentProjectId, graph: { nodes, edges, request } });
      const after = snapshotFlow(currentProjectId, next, applied.map(node => node.id));
      setNodes([...next.nodes]); setEdges([...next.edges]); setEditUndo({ before: editDraft.snapshot, after }); setEditDraft(null);
      setSelectedGroup(applied[0]?.groupId || null); setSelected(applied.find(node => node.type === 'image')?.id ?? applied[0]?.id ?? null);
      setSelectionIds([]); setBatchTasks([]); setConnectSource(null); setActiveNodeIds([]); setRunState('idle'); setRunLabel('실행 대기'); setRunProgress('');
      setMessage('선택한 플로우에 수정안을 적용했어요. 입력 사진과 이전 결과 폴더는 보존했어요.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '수정안을 적용하지 못했어요.'); }
  };
  const undoFlowEdit = () => {
    if (!editUndo || executionRef.current || planningRef.current || uploading || editDraft) return;
    try {
      const next = replaceFlow(editUndo.after, editUndo.before, { projectId: currentProjectId, graph: { nodes, edges, request } });
      setNodes([...next.nodes]); setEdges([...next.edges]); setSelectedGroup(editUndo.before.nodes[0]?.groupId || null);
      setSelected(editUndo.before.nodes.find(node => node.type === 'image')?.id ?? editUndo.before.nodes[0]?.id ?? null);
      setSelectionIds([]); setBatchTasks([]); setConnectSource(null); setActiveNodeIds([]); setEditUndo(null);
      setRunState('idle'); setRunLabel('실행 대기'); setRunProgress(''); setMessage('자연어 수정 전 플로우로 되돌렸어요.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '플로우를 되돌리지 못했어요.'); }
  };
  const scopeStyles = toolScope.filter(node => node.type === 'prompt' && node.commonStyle);
  const scopeStyle = scopeStyles[0];
  const currentStyleTargets = styleTargetIds(toolScope, edges);
  const styleTargets = toolScope.filter(node => currentStyleTargets.has(node.id));
  const canApplyStyle = styleTargets.length > 0 && new Set(toolScope.map(node => node.groupId)).size === 1;
  const persistTemplates = (next: WorkflowTemplate[]) => {
    try { localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(next)); setTemplates(next); return true; }
    catch { setMessage('템플릿을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.'); return false; }
  };
  const saveTemplate = (name: string) => {
    if (executionRef.current || planningRef.current) return false;
    try {
      if (templates.length >= 30) throw new Error('템플릿은 30개까지 저장할 수 있어요.');
      const ids = new Set(toolScope.map(node => node.id));
      const template = makeTemplate(crypto.randomUUID(), name, toolScope, edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)), request);
      if (!persistTemplates([template, ...templates])) return false;
      setMessage(`${template.name} 템플릿을 저장했어요. 이미지와 결과는 포함하지 않아요.`); return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : '템플릿을 저장하지 못했어요.'); return false; }
  };
  const insertToolFlow = (built: { nodes: (Omit<StudioNode, 'title' | 'subtitle'>)[]; edges: Edge[] }, id: string, name: string) => {
    if (nodes.length + built.nodes.length > 500 || edges.length + built.edges.length > 2000 || groups.length >= 100) throw new Error('프로젝트 크기 제한에 도달했어요. 새 프로젝트에 추가해 주세요.');
      setNodes(current => [...current, ...built.nodes.map(node => ({ ...node, ...nodeCatalog[node.type], title: node.taskTitle || nodeCatalog[node.type].title, subtitle: node.taskDetail || nodeCatalog[node.type].subtitle }))]);
    setEdges(current => [...current, ...built.edges]); setGroups(current => [...current, { id, name: name.slice(0,100) }]);
    setSelectedGroup(id); setSelected(built.nodes.find(node => node.type === 'image')?.id ?? null); setSelectionIds([]); setConnectSource(null);
    if (!executionRef.current) { setBatchTasks([]); setRunState('idle'); setRunLabel('실행 대기'); }
    setActiveView('studio'); setViewerImage(null); setShowPresets(false); setCanvasZoom(.7); setCanvasPan({ x: 0, y: -(Math.min(...built.nodes.map(node => node.y)) - 150) * .7 });
  };
  const useTemplate = (template: WorkflowTemplate) => {
    if (planningRef.current) return;
    try {
      const id = crypto.randomUUID(), base = Math.max(Date.now(), ...nodes.map(node => node.id + 1), ...edges.map(edge => edge.id + 1));
      insertToolFlow(instantiateTemplate(template, base, id, nodes.length ? Math.max(...nodes.map(node => node.y)) + 500 : 150), id, template.name);
      setMessage(`${template.name}을 새 그룹으로 추가했어요. 입력 이미지를 넣고 실행하세요.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '템플릿을 추가하지 못했어요.'); }
  };
  const startVisualTask = (task: VisualTaskId, results: readonly ImageResult[] = []) => {
    if (planningRef.current) return;
    try {
      const id = crypto.randomUUID(), base = Math.max(Date.now(), ...nodes.map(node => node.id + 1), ...edges.map(edge => edge.id + 1));
      const images = results.map(image => ({ id: crypto.randomUUID(), name: image.name, url: image.url }));
      const title = ({ cutout: '배경 제거', background: '배경 변경', advertising: '광고 연출' })[task];
      insertToolFlow(buildTaskFlow(images, task, base, id, nodes.length ? Math.max(...nodes.map(node => node.y)) + 500 : 150), id, `${title} · ${images.length ? `${images.length}장` : '새 작업'}`);
      setMessage(images.length ? `${images.length}장을 ${title}의 새 입력으로 복사했어요. 스타일을 선택하고 그룹 실행을 눌러 주세요.` : `${title} 플로우를 만들었어요. 입력 사진을 추가해 주세요.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '작업을 추가하지 못했어요.'); }
  };
  const applyCommonStyle = (style: CommonStyle) => {
    if (toolScopeBusy || planningRef.current || !canApplyStyle) return;
    const scopeIds = new Set(toolScope.map(node => node.id));
    const scopedEdges = edges.filter(edge => scopeIds.has(edge.source) && scopeIds.has(edge.target));
    if (style.background !== 'original' && styleTargets.some(node => transparentOperationIds(toolScope, scopedEdges).has(node.id))) { setMessage('누끼는 투명 배경이 필요해요. 배경은 원본 유지로 두거나 배경 변경 작업을 선택해 주세요.'); return; }
    if (!scopeStyle && (nodes.length >= 500 || edges.length + styleTargets.length > 2000)) { setMessage('프로젝트 크기 제한에 도달했어요.'); return; }
    const id = scopeStyle?.id ?? Math.max(Date.now(), ...nodes.map(node => node.id + 1), ...edges.map(edge => edge.id + 1));
    const styleNode: StudioNode = { id, type: 'prompt',  ...nodeCatalog.prompt, title: scopeStyle?.taskTitle || nodeCatalog.prompt.title, subtitle: scopeStyle?.taskDetail || nodeCatalog.prompt.subtitle, x: 70, y: Math.max(...toolScope.map(node => node.y)) + 300, groupId: toolScope[0]?.groupId, commonStyle: style, taskTitle: scopeStyle?.taskTitle, taskDetail: scopeStyle?.taskDetail, prompt: stylePrompt(style) };
    const styleIds = new Set(scopeStyles.map(node => node.id));
    setNodes(current => [...current.filter(node => !styleIds.has(node.id)), styleNode]);
    let edgeId = Math.max(id + 1, ...edges.map(edge => edge.id + 1));
    setEdges(current => [...current.filter(edge => !styleIds.has(edge.source) && !styleIds.has(edge.target)), ...styleTargets.map(node => ({ id: edgeId++, source: id, target: node.id }))]);
    if (!executionRef.current) setBatchTasks([]); setMessage(`${toolScopeName}에 공통 스타일을 적용했어요. 다음 실행부터 사용됩니다.`);
  };
  const clearCommonStyle = () => {
    if (toolScopeBusy || planningRef.current || !scopeStyle) return;
    const styleIds = new Set(scopeStyles.map(node => node.id));
    setNodes(current => current.filter(node => !styleIds.has(node.id))); setEdges(current => current.filter(edge => !styleIds.has(edge.source) && !styleIds.has(edge.target)));
    if (selected !== null && styleIds.has(selected)) setSelected(null);
    if (!executionRef.current) setBatchTasks([]); setMessage('공통 스타일을 해제했어요.');
  };
  const selectToolGroup = (id: string | null) => {
    setSelectedGroup(id); setSelected(null);
    const members = nodes.filter(node => node.groupId === id);
    if (!id || !members.length) return;
    setCanvasZoom(.7); setCanvasPan({ x: 0, y: -(Math.min(...members.map(node => node.y)) - 150) * .7 });
  };
  const resetProject = () => {
    setCurrentProjectId(crypto.randomUUID()); setProjectName('빈 작업실'); setNodes([]); setGroups([]); setSelectedGroup(null); setSelectionIds([]); setBatchTasks([]); setEdges([]); setRequest(''); setImageUrl(''); setImageName(''); setHistory([]); setSelected(null); setConnectSource(null); setActiveNodeIds([]); setRunState('idle'); setRunLabel('실행 대기'); setRunProgress(''); setLastSavedAt(null); setShowProjects(false); setViewerImage(null); setOpenedResultFolder(null);
    setHydrationFailed(false); setHydrated(true);
  };
  const withProjectTransition = async (change: () => void | Promise<void>) => {
    if (navigation) {
      if (projectTransition.current || (!hydrated && !hydrationFailed)) return;
      projectTransition.current = true;
      try {
        if (hydrated) {
          await flushStorage();
          const saved: SavedProject[] = JSON.parse(localStorage.getItem('gpt-node-studio-projects-v1') || '[]');
          const next = [{ id: currentProjectId, name: projectName.trim() || '빈 작업실', updatedAt: new Date().toISOString() }, ...saved.filter(item => item.id !== currentProjectId)].slice(0, 20);
          localStorage.setItem('gpt-node-studio-projects-v1', JSON.stringify(next)); setProjects(next);
        }
        await change();
      } catch (error) { setMessage(error instanceof Error ? `프로젝트를 저장하거나 전환하지 못했어요. ${error.message}` : '프로젝트를 전환하지 못했어요.'); }
      finally { projectTransition.current = false; }
      return;
    }
    if (executionRef.current || planningRef.current || (!hydrated && !hydrationFailed)) return;
    const controller = new AbortController(); planningRef.current = controller; setPlanning(true);
    try {
      if (hydrated) await flushStorage();
      await change();
    } catch (error) {
      setMessage(error instanceof Error ? `프로젝트를 저장하거나 전환하지 못했어요. ${error.message}` : '프로젝트를 저장하거나 전환하지 못했어요.');
    } finally { planningRef.current = null; setPlanning(false); }
  };
  const createProject = async () => withProjectTransition(() => { if (navigation) navigation.create(); else { resetProject(); setMessage('새 프로젝트를 시작했어요'); } });
  const openProject = async (project: SavedProject) => {
    if (navigation) { await withProjectTransition(() => navigation.open(project)); return; }
    await withProjectTransition(async () => {
      const raw = localStorage.getItem(`gpt-node-studio-project-${project.id}`);
      if (!raw) { setMessage('저장된 프로젝트 내용을 찾지 못했어요'); return; }
      const parsed = JSON.parse(raw) as { imageStorageVersion?: number; projectName?: string; nodes?: StudioNode[]; groups?: StudioGroup[]; edges?: Edge[]; request?: string; imageName?: string; history?: ImageHistoryEntry[] };
      const savedNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
      const savedHistory = Array.isArray(parsed.history) ? parsed.history : [];
      const images = await loadImageRecords(['global', ...imageRecordKeys(savedNodes), ...savedHistory.map((entry) => `history:${entry.id}`)], project.id, parsed.imageStorageVersion !== 2);
      const normalizedNodes = normalizeNodes(savedNodes);
      const restoredGroups = parseGroups(parsed.groups, normalizedNodes, parsed.edges || []);
      setCurrentProjectId(project.id); setProjectName(parsed.projectName || project.name);
      setNodes(restoreNodeImages(normalizedNodes, images));
      setGroups(restoredGroups); setSelectedGroup(null); setSelectionIds([]); setBatchTasks([]);
      setEdges(Array.isArray(parsed.edges) ? parsed.edges : []);
      setRequest(parsed.request || ''); setImageName(parsed.imageName || ''); setImageUrl(images.global || '');
      setHistory(savedHistory.map((entry) => ({ ...entry, url: images[`history:${entry.id}`] || '' })).filter((entry) => entry.url));
      setSelected(null); setConnectSource(null); setActiveNodeIds([]); setRunState('idle'); setRunLabel('실행 대기'); setRunProgress(''); setShowProjects(false);
      setViewerImage(null); setOpenedResultFolder(null); setHydrationFailed(false); setHydrated(true);
      setMessage(`${project.name} 프로젝트를 열었어요`);
    });
  };
  const saveProject = async () => {
    if (!hydrated || planningRef.current) return;
    const name = projectName.trim() || '빈 작업실';
    const updatedAt = new Date().toISOString();
    const snapshot = { projectId: currentProjectId, imageStorageVersion: 2, projectName: name, nodes: imageMetadata(nodes), groups, edges, request, imageName, history: history.map(({ url: _url, ...entry }) => entry) };
    const records = nodeImageRecords(nodes);
    records.push({ key: 'global', url: imageUrl });
    history.forEach((entry) => records.push({ key: `history:${entry.id}`, url: entry.url }));
    try {
      pendingSave.current = async () => {
        await saveImageRecords(records, currentProjectId);
        if (activeWorkspace.current) localStorage.setItem('gpt-node-studio-workflow-v2', JSON.stringify(snapshot));
        localStorage.setItem(`gpt-node-studio-project-${currentProjectId}`, JSON.stringify(snapshot));
      };
      await flushStorage();
      const savedProjects: SavedProject[] = JSON.parse(localStorage.getItem('gpt-node-studio-projects-v1') || '[]');
      const nextProjects = [{ id: currentProjectId, name, updatedAt }, ...savedProjects.filter((item) => item.id !== currentProjectId)].slice(0, 20);
      localStorage.setItem('gpt-node-studio-projects-v1', JSON.stringify(nextProjects));
      setProjects(nextProjects); setProjectName(name); setLastSavedAt(updatedAt); setMessage(`프로젝트를 저장했어요 · ${name}`);
    } catch { setMessage('프로젝트를 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.'); }
  };
  const exportProject = () => {
    const blob = new Blob([JSON.stringify({ format: 'gpt-node-studio', version: 1, projectName, nodes, groups, edges, request, imageUrl, imageName, history })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'studio-project.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('이미지를 포함한 프로젝트 백업을 내보냈어요.');
  };
  const importProject = async (file: File) => {
    if (executionRef.current || planningRef.current) return;
    const controller = new AbortController(); planningRef.current = controller; setPlanning(true);
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error('백업 파일은 64MB 이하로 선택해 주세요.');
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        const abort = () => reader.abort();
        controller.signal.addEventListener('abort', abort, { once: true });
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('백업 내용을 읽지 못했어요.'));
        reader.onerror = () => reject(reader.error || new Error('백업 파일을 읽지 못했어요.'));
        reader.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
        reader.onloadend = () => controller.signal.removeEventListener('abort', abort);
        reader.readAsText(file);
      });
      const backup = parseProjectBackup(JSON.parse(content)); controller.signal.throwIfAborted();
      await flushStorage(); controller.signal.throwIfAborted();
      setCurrentProjectId(crypto.randomUUID()); setProjectName(backup.projectName);
      setNodes(normalizeNodes(backup.nodes.map((node) => ({ ...node, ...nodeCatalog[node.type] })))); setGroups(backup.groups); setSelectedGroup(null); setSelectionIds([]); setBatchTasks([]); setEdges(backup.edges);
      setRequest(backup.request); setImageUrl(backup.imageUrl); setImageName(backup.imageName); setHistory(backup.history);
      setSelected(null); setConnectSource(null); setRunState('idle'); setRunLabel('실행 대기'); setLastSavedAt(null);
      setMessage('백업을 새 프로젝트로 가져왔어요. 프로젝트 저장을 눌러 목록에 추가하세요.');
    } catch (error) { setMessage(controller.signal.aborted ? '백업 가져오기를 취소했어요.' : error instanceof Error ? error.message : '백업을 읽지 못했어요.'); } finally { planningRef.current = null; setPlanning(false); }
  };
  const downloadImage = () => {
    if (!imageUrl) { setMessage('먼저 실행 결과를 만들어 주세요'); return; }
    const mime = imageUrl.match(/^data:([^;,]+)/)?.[1] || 'image/png';
    const extension = mime === 'image/gif' ? 'gif' : mime === 'image/apng' ? 'apng' : mime === 'image/webp' ? 'webp' : mime === 'image/jpeg' ? 'jpg' : 'png';
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `frameflow-motion-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
    document.body.appendChild(link); link.click(); link.remove();
    setMessage(`${extension.toUpperCase()} 결과를 다운로드했어요`);
  };

  const resultCount = resultUnits(history).length;
  if (!hydrated) return <main className="app-shell">{hydrationFailed ? <section role="alert"><p>{message}</p><button className="ghost" onClick={() => window.location.reload()}>다시 불러오기</button><button className="primary" onClick={() => void createProject()}>새 프로젝트로 시작</button></section> : <p role="status">저장된 작업을 불러오고 있어요…</p>}</main>;
  return <main className="app-shell"><header className="topbar"><div className="brand"><img className="brand-lockup" src="/brand/frameflow-logo-transparent.png" alt="Frameflow" /></div><nav className="workspace-nav" aria-label="작업 영역"><button className={activeView === 'studio' ? 'nav-tab active' : 'nav-tab'} onClick={() => setActiveView('studio')}>작업실</button><button className={activeView === 'results' ? 'nav-tab active' : 'nav-tab'} onClick={() => { setOpenedResultFolder(null); setActiveView('results'); }}>결과물{history.length ? ` · ${resultCount}` : ''}</button></nav><div className="top-actions"><div className="project-menu-wrap"><button className="ghost project-menu-button" onClick={() => setShowProjects((value) => !value)}>프로젝트{projects.length ? ` · ${projects.length}` : ''}</button>{showProjects && <div className="project-menu" role="menu"><div className="project-menu-head"><strong>저장된 프로젝트</strong><small>이 브라우저에 저장됨</small></div><button className="project-new-button" onClick={createProject}>＋ 새 프로젝트</button><div className="project-menu-actions"><button className="project-menu-action" onClick={saveProject}>저장</button><button className="project-menu-action" onClick={resetFlow}>플로우 초기화</button><button className="project-menu-action" onClick={() => void clearImages()}>이미지 삭제</button></div>{projects.length ? projects.map((project) => <div className="project-list-item" key={project.id}><button className={project.id === currentProjectId ? 'project-list-open active' : 'project-list-open'} onClick={() => openProject(project)}><span>{project.name}</span><small>{new Date(project.updatedAt).toLocaleDateString('ko-KR')}</small></button><button className="project-list-delete" aria-label={`${project.name} 프로젝트 삭제`} onClick={() => void deleteProject(project)}>삭제</button></div>) : <div className="project-empty">저장한 프로젝트가 없어요.<br />현재 작업에서 저장을 눌러 주세요.</div>}</div>}</div>{backgroundProjects.length > 0 && <div className="background-projects" aria-label="다른 프로젝트 작업 상태">{backgroundProjects.map(project => <button className="ghost" key={project.id} onClick={() => void openProject({ ...project, updatedAt: '' })}>작업 중 · {project.name}</button>)}</div>}<span className="save-state">{lastSavedAt ? '저장됨' : '저장 대기'}</span><span className={`local-status status-icon ${status === '연결됨' ? 'connected' : ''}`} title={status} aria-label={status}>{status === '연결됨' ? '●' : '○'}</span><button className="ghost" disabled={runState === 'running' || planning} onClick={() => void startLogin()}>계정 연결</button>{status === '연결됨' && <button className="ghost" disabled={runState === 'running' || planning} onClick={async () => { const response = await localBridgeFetch('/auth/logout', { method: 'POST' }); if (response.ok) { setDeviceAuth(null); setStatus('계정 연결 필요'); setMessage('이 브라우저의 계정 연결을 해제했어요'); } }}>로그아웃</button>}<button className="primary" disabled={runState === 'running' || planning} onClick={() => void runWorkflow()}>{runState === 'running' ? '⏳ 워크플로우 처리 중' : selectedGroup ? '▶ 선택 그룹 실행' : selected ? '▶ 선택 워크플로우 실행' : '▶ 전체 실행'}</button></div></header>{activeView === 'results' ? <ResultsPanel busy={planning} onNext={(images, task) => startVisualTask(task, images)} history={history} projectId={currentProjectId} initialFolder={openedResultFolder} onStudio={() => setActiveView('studio')} onView={image => setViewerImage(image)} onReuse={image => reuseImage(image.url,image.name)} onDownload={downloadResult} onRename={renameResultFolder} /> : <div className="content-grid"><aside className="sidebar"><div className="side-heading">노드 추가</div>{(Object.keys(nodeCatalog) as NodeType[]).map((type) => <button className="node-tool" key={type} onClick={() => addNode(type)}><span className="tool-icon">＋</span><span><b>{nodeCatalog[type].title}</b><small>{nodeCatalog[type].subtitle}</small></span></button>)}<div className="node-guide"><b>캔버스 조작</b><p>노드를 선택하고 드래그하세요. 연결선은 클릭하면 해제되고, 선택한 노드는 Delete로 삭제할 수 있어요.</p></div></aside><section className="workspace"><div className="workspace-head"><div><span className="eyebrow">프로젝트</span><input className="project-name-input" aria-label="프로젝트 이름" value={projectName} onChange={(event) => setProjectName(event.target.value)} onBlur={saveProject} onKeyDown={(event) => { if (event.key === 'Enter') { event.currentTarget.blur(); } }} /></div>{nodes.length > 0 && <span className="badge">{nodes.length}개 노드 · {edges.length}개 연결</span>}</div><div ref={canvasRef} className="canvas" style={{ backgroundPosition: `${12 * canvasZoom + canvasPan.x}px ${12 * canvasZoom + canvasPan.y}px`, backgroundSize: `${24 * canvasZoom}px ${24 * canvasZoom}px` }} onPointerDown={(event) => { const target = event.target as HTMLElement; if (target.closest('.wf-node, .canvas-toolbar, .group-frame')) return; event.currentTarget.setPointerCapture(event.pointerId); setBoardDrag({ pointerX: event.clientX, pointerY: event.clientY, panX: canvasPan.x, panY: canvasPan.y }); }} onPointerCancel={() => setBoardDrag(null)} onLostPointerCapture={() => setBoardDrag(null)}><div className="canvas-toolbar"><span className="canvas-hint">{connectSource ? '입력 포트를 선택하세요' : '포트를 선택해 연결'}</span><div className="canvas-toolbar-actions"><button className="zoom-button" aria-label="캔버스 축소" onClick={() => setCanvasZoom((value) => Math.max(.6, Number((value - .1).toFixed(1))))}>−</button><button className="zoom-value" aria-label="캔버스 맞춤" onClick={fitCanvas}>{Math.round(canvasZoom * 100)}%</button><button className="zoom-button" aria-label="캔버스 확대" onClick={() => setCanvasZoom((value) => Math.min(1.6, Number((value + .1).toFixed(1))))}>＋</button></div></div><div className="canvas-world" style={{ transform: `translate3d(${canvasPan.x}px, ${canvasPan.y}px, 0) scale(${canvasZoom})` }}><svg className="edge-layer" aria-label="노드 연결선">{edges.map((edge) => { const source = nodes.find((node) => node.id === edge.source); const target = nodes.find((node) => node.id === edge.target); if (!source || !target) return null; const nodeWidth = source.type === 'image' ? 250 : 190, sourcePortY = source.type === 'image' ? 112 : 92.5, targetPortY = target.type === 'image' ? 112 : 55.5; const x1 = source.x + nodeWidth, y1 = source.y + sourcePortY, x2 = target.x, y2 = target.y + targetPortY; return <><path key={`${edge.id}-hit`} className="graph-edge-hit" d={`M ${x1} ${y1} C ${x1 + Math.max(46, (x2 - x1) * .38)} ${y1}, ${x2 - Math.max(46, (x2 - x1) * .38)} ${y2}, ${x2} ${y2}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => { if (executionRef.current || planningRef.current) return; setEdges((current) => current.filter((item) => item.id !== edge.id)); setMessage('선택한 연결을 해제했어요'); }} /><path key={edge.id} className="graph-edge" pathLength="1" d={`M ${x1} ${y1} C ${x1 + Math.max(46, (x2 - x1) * .38)} ${y1}, ${x2 - Math.max(46, (x2 - x1) * .38)} ${y2}, ${x2} ${y2}`} onClick={() => { if (executionRef.current || planningRef.current) return; setEdges((current) => current.filter((item) => item.id !== edge.id)); setMessage('선택한 연결을 해제했어요'); }} /> </>; })}</svg>{groups.map(group => { const members = nodes.filter(node => node.groupId === group.id); if (!members.length) return null; const bounds = groupBounds(members); return <div key={group.id} className={`group-frame ${selectedGroup === group.id ? 'group-selected' : ''}`} style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}><button className="group-drag-handle" aria-label={`${group.name} 그룹 이동`} disabled={runState === 'running' || planning} onPointerDown={event => { if (executionRef.current || planningRef.current) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedGroup(group.id); setSelected(null); setGroupDrag({ pointerX: event.clientX, pointerY: event.clientY, positions: members.map(node => ({ id: node.id, x: node.x, y: node.y })) }); }} onPointerCancel={() => setGroupDrag(null)} onLostPointerCapture={() => setGroupDrag(null)}>{group.name}<small>{members.filter(node => node.type === 'image').reduce((total, node) => total + (node.images?.length ?? 1), 0)}장 · 드래그로 이동</small></button></div>; })}{nodes.length === 0 && <div className="empty-canvas"><b>작업을 시작해보세요</b><span>오른쪽에서 노드를 추가하거나 자연어로 작업 순서를 만들어보세요.</span></div>}{nodes.map((node) => <div key={node.id} className={`wf-node ${node.type === 'command' ? 'node-command' : ''} ${selected === node.id || selectionIds.includes(node.id) || (selectedGroup !== null && node.groupId === selectedGroup) ? 'selected' : ''} ${activeNodeIds.includes(node.id) ? 'node-running' : ''}`} style={{ left: node.x, top: node.y }} onPointerDown={(event) => { if (executionRef.current || planningRef.current) return; const target = event.target as HTMLElement; if (target.closest('.port') || target.closest('label') || target.closest('textarea') || target.closest('input') || target.closest('button')) return; setSelectedGroup(null); setSelected(node.id); event.currentTarget.setPointerCapture(event.pointerId); setDrag({ id: node.id, pointerX: event.clientX, pointerY: event.clientY, nodeX: node.x, nodeY: node.y }); }} onClick={(event) => { setSelectedGroup(null); setSelected(node.id); if (event.shiftKey || event.metaKey || event.ctrlKey) setSelectionIds(current => current.includes(node.id) ? current.filter(id => id !== node.id) : [...current, node.id]); }} onPointerCancel={() => setDrag(null)} onLostPointerCapture={() => setDrag(null)}><button className="port port-in" aria-label={`${node.title} 입력 포트`} onClick={(event) => { event.stopPropagation(); connect(node.id); }} /> <label className="node-select" onClick={event => event.stopPropagation()}><input type="checkbox" aria-label={`${node.title} ${node.id} 그룹 선택`} checked={selectionIds.includes(node.id)} disabled={runState === 'running' || planning} onChange={event => { setSelectedGroup(null); setSelectionIds(current => event.target.checked ? [...current, node.id] : current.filter(id => id !== node.id)); }} />선택</label><span className="node-kicker">{node.type}</span>{node.type === 'image' && <label className="node-image-drop" onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('dragover'); }} onDragLeave={(event) => event.currentTarget.classList.remove('dragover')} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove('dragover'); const files = Array.from(event.dataTransfer.files); if (node.images) void appendBatchFiles(node.id, files); else if (files[0]) void addImageToNode(files[0], node.id); }}><input type="file" multiple={Boolean(node.images)} accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const files = Array.from(event.target.files || []); if (node.images) void appendBatchFiles(node.id, files); else if (files[0]) void addImageToNode(files[0], node.id); event.currentTarget.value = ''; }} />{node.images?.length ? <div className="batch-input-grid" aria-label="입력 이미지 목록">{node.images.map((image) => <div className="batch-input-item" key={image.id}><img src={image.url} alt={image.name} /><span title={image.name}>{image.name}</span></div>)}</div> : node.imageUrl ? <img className="node-input-image" src={node.imageUrl} alt={node.imageName || '입력 이미지'} /> : <><span className="node-image-plus">＋</span><b>이미지 추가</b><small>클릭하거나 드래그</small></>}</label>}{node.type === 'image' && node.images && <span className="batch-node-badge">{node.images.length}장 · 공통 처리 · {node.batchOutput === 'sheet' ? '한 장 배치' : '개별 출력'}</span>}{node.type === 'preview' && <div className="node-preview-output">{node.previewMode !== 'sheet' && node.images?.length ? <div className="batch-preview-grid">{node.images.map(image => <button key={image.id} aria-label={`${image.name} 개별 결과 크게 보기`} onClick={event => { event.stopPropagation(); setViewerImage({ id: image.id, name: image.name, url: image.url, createdAt: new Date().toISOString() }); }}><img src={image.url} alt={`${image.name} 누끼 결과`} /></button>)}</div> : node.imageUrl ? <img src={node.imageUrl} alt={node.imageName || '생성 결과'} /> : <span>실행 결과 대기</span>}</div>}{node.type === 'preview' && node.images && <span className="batch-node-badge">개별 결과 {node.images.length}장</span>}{node.type === 'preview' && node.images && node.previewMode === 'sheet' && <div className="batch-preview-list">{node.images.map(image => <button key={image.id} aria-label={`${image.name} 개별 결과 크게 보기`} onClick={event => { event.stopPropagation(); setViewerImage({ id: image.id, name: `${image.name} · 결과`, url: image.url, createdAt: new Date().toISOString() }); }}><img src={image.url} alt={`${image.name} 누끼 결과`} /></button>)}</div>}{node.type === 'preview' && node.resultFolder && node.previewMode !== 'sheet' && Boolean(node.images?.length) && <button className="preview-folder-button" onClick={event => { event.stopPropagation(); setOpenedResultFolder(node.resultFolder?.id || null); setActiveView('results'); }}>결과 폴더 열기</button>}{(node.type === 'prompt' || node.type === 'command' || node.type === 'motion') && <textarea disabled={nodeBusy(node.id) || planning || Boolean(node.commonStyle)} className="node-prompt-input" aria-label={`${node.title} 명령 입력`} value={node.prompt || ''} placeholder={node.type === 'command' ? '입력·설정 패널에서 연출 명령을 선택하세요' : '이 노드에서 사용할 프롬프트'} onChange={(event) => setNodes((current) => current.map((item) => item.id === node.id ? { ...item, prompt: event.target.value } : item))} />}<b>{node.title}</b><small>{node.subtitle}</small><button className={`port port-out ${connectSource === node.id ? 'active' : ''}`} aria-label={`${node.title} 출력 포트`} onClick={(event) => { event.stopPropagation(); setConnectSource(node.id); setSelected(node.id); setMessage('연결할 입력 포트를 선택하세요'); }} /></div>)}</div></div></section><aside className="assistant"><div className="assistant-head"><div><strong>{selectedNode ? '선택한 노드' : '작업 패널'}</strong>{selectedNode && <small>{selectedNode.title}</small>}</div><div className="assistant-float-actions"><button aria-label="노드 추가 패널" aria-expanded={showNodePalette} className={showNodePalette ? 'float-toggle active' : 'float-toggle'} onClick={() => { setPanelTab('create'); setShowNodePalette((value) => !value); setShowPresets(false); }}>＋ 노드</button><button aria-label="프리셋 패널" aria-expanded={showPresets} className={showPresets ? 'float-toggle active' : 'float-toggle'} onClick={() => { setPanelTab('create'); setShowPresets((value) => !value); setShowNodePalette(false); }}>프리셋</button></div></div><div className="inspector-tabs" role="tablist" aria-label="작업 패널">{([{id:'create',label:'작업 만들기'},{id:'configure',label:'입력·설정'},{id:'library',label:'템플릿'}] as const).map((tab,index) => <button type="button" role="tab" id={`panel-tab-${tab.id}`} aria-selected={panelTab === tab.id} aria-controls={`panel-body-${tab.id}`} tabIndex={panelTab === tab.id ? 0 : -1} key={tab.id} onClick={() => setPanelTab(tab.id)} onKeyDown={event => { const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0; if (!direction) return; event.preventDefault(); const tabs = ['create','configure','library'] as const; const target = (index + direction + tabs.length) % tabs.length; setPanelTab(tabs[target]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus(); }}>{tab.label}</button>)}</div><section className="panel-run-summary" aria-label="현재 실행 상태" aria-live="polite"><div className="panel-run-heading"><strong>{runLabel}</strong><small>{toolScopeName}</small></div>{runProgress && <p className="run-progress-line">{runProgress.replace('이미지 요청', '요청').replace(' · 최대 2장 동시 처리', ' · 동시에 최대 2장')}</p>}{runMetrics.total > 0 && <div className="execution-progress" aria-label="실행 진행률"><div className="execution-progress-meta"><strong>{runMetrics.stage}</strong><span>{Math.round(Math.min(100, (runMetrics.requested / runMetrics.total) * 100))}%</span></div><div className="execution-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={runMetrics.total} aria-valuenow={runMetrics.requested} aria-label={`요청 ${runMetrics.requested} / ${runMetrics.total}`}><span style={{ width: `${Math.min(100, (runMetrics.requested / runMetrics.total) * 100)}%` }} /></div><div className="execution-progress-counts"><span>요청 <b>{runMetrics.requested}/{runMetrics.total}</b></span><span>완료 <b>{runMetrics.completed}</b></span><span>실패 <b>{runMetrics.failed}</b></span><span>남은 요청 <b>{Math.max(0, runMetrics.total - runMetrics.requested)}</b></span></div></div>}{runState === 'running' ? <p className="run-status-note">현재 작업을 처리하고 있어요. 완료된 결과는 결과물에 저장돼요.</p> : message.length > 160 && runState !== 'error' && !planning ? <details className="panel-status-detail"><summary>{message.slice(0,80)}…</summary><p>{message}</p></details> : <p className={runState === 'error' ? 'panel-error' : ''}>{message}</p>}<p className="request-estimate">예상 요청 {workflowGroups(nodes, edges, selectedGroup ? null : selected).filter(chain => !selectedGroup || chain.some(node => nodes.find(item => item.id === node.id)?.groupId === selectedGroup)).reduce((total, chain) => total + estimateSharedRequests(chain), 0)}회</p>{runState === 'running' && <button className="ghost" onClick={() => { executionRef.current?.abort(); setMessage('취소 요청 중… 이미 전송된 요청은 사용량에 포함될 수 있어요.'); }}>실행 취소</button>}</section><div id="panel-body-create" role="tabpanel" aria-labelledby="panel-tab-create" hidden={panelTab !== 'create'} className="inspector-tab-body">{showNodePalette && !showPresets && <section className="node-palette"><div className="palette-heading"><b>노드 추가</b><span>선택한 노드만 캔버스에 들어가요</span></div><div className="palette-grid">{(Object.keys(nodeCatalog) as NodeType[]).map((type) => <button className="node-tool" key={type} onClick={() => addNode(type)}><span className="tool-icon">＋</span><span><b>{nodeCatalog[type].title}</b><small>{nodeCatalog[type].subtitle}</small></span></button>)}</div></section>}{showPresets && !showNodePalette && <section className="preset-section preset-panel"><div className="preset-heading"><b>빠른 프리셋</b><span>자주 쓰는 작업 구조</span></div><div className="preset-list">{presetDefinitions.map((preset) => <button className="preset-card" key={preset.id} onClick={() => applyPreset(preset)}><strong>{preset.title}</strong><small>{preset.description}</small></button>)}</div></section>}<section className="panel-compose" aria-label="자연어로 새 플로우 만들기"><label className="panel-section-title" htmlFor="request">무엇을 만들까요?</label><textarea id="request" maxLength={8000} disabled={planning} value={request} onChange={(event) => setRequest(event.target.value)} placeholder="예: 이 사진들을 각각 누끼 따고, 베이지 배경으로 바꾼 뒤 선명도를 개선해 같은 폴더에 담아줘."/><p className="panel-context-hint">{toolScopeName} · 새 그룹으로 추가</p><div className="panel-action-row"><button className="plan-btn" disabled={planning || uploading} onClick={plan}>{uploading ? '이미지 준비 중…' : planning ? '흐름 구성 중…' : '플로우 만들기'}</button>{planning && <button className="ghost" onClick={() => planningRef.current?.abort()}>취소</button>}</div></section>{!showNodePalette && !showPresets && <details className="panel-advanced panel-quick-tasks"><summary>빠른 작업</summary><VisualTaskCards busy={planning} onChoose={task => startVisualTask(task)} /></details>}<details className="panel-advanced"><summary>단일 이미지 노드 추가</summary>{selectedNode?.type !== 'image' && <label className="upload-box" onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('dragover'); }} onDragLeave={(event) => event.currentTarget.classList.remove('dragover')} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove('dragover'); const file = event.dataTransfer.files?.[0]; if (file) addUploadedImage(file); }}><input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) addUploadedImage(file); event.currentTarget.value = ''; }} /><span>＋</span><b>이미지 추가</b><small>{imageName || 'PNG, JPG, WEBP를 선택하거나 여기에 드래그하세요'}</small></label>}</details></div><div id="panel-body-configure" role="tabpanel" aria-labelledby="panel-tab-configure" hidden={panelTab !== 'configure'} className="inspector-tab-body">{batchInput && <ImageBatchPanel images={batchInput.images || []} output={batchInput.batchOutput || 'each'} busy={toolScopeBusy} onFiles={files => void appendBatchFiles(batchInput.id, files)} onRemove={id => removeBatchImage(batchInput.id, id)} onOutput={output => setBatchOutput(batchInput.id, output)} canAssemble={canAssembleBatch(batchInput)} onAssemble={() => void assembleStoredBatch(batchInput)} />}<WorkflowEditPanel requesting={editing} scope={canEditFlow ? toolScopeName : '수정 대상 선택 필요'} canEdit={canEditFlow} busy={runState === 'running' || planning || uploading} review={editDraft ? { scope: editDraft.scope, instruction: editDraft.instruction, summary: editDraft.built.summary, warnings: editDraft.built.warnings, requests: editDraft.built.requests, diff: editDraft.built.diff, steps: editDraft.built.nodes } : null} canUndo={canUndoEdit} hasUndo={Boolean(editUndo)} onSubmit={instruction => void requestFlowEdit(instruction)} onApply={applyFlowEdit} onDiscard={() => { setEditDraft(null); setMessage('수정안을 버렸어요. 기존 플로우는 유지돼요.'); }} onUndo={undoFlowEdit} onCancel={() => planningRef.current?.abort()} /><WorkflowPlanPanel nodes={toolScope} edges={edges} busy={planning} onSelect={id => setSelected(id)} />{selectedNode && !selectedNode.commonStyle && !(selectedNode.type === 'image' && batchInput) && <section className="prompt-inspector"><div className="inspector-title"><span className="eyebrow">선택한 도구</span><span className="inspector-type">{selectedNode.type}</span></div><div className="inspector-node-head"><h2>{selectedNode.title}</h2><button className="ghost" onClick={duplicateNode} title="선택한 노드 복제">복제</button></div>{selectedNode.type === 'command' && <div className="command-chips" aria-label="선택한 명령 조합">{getCommandTokens(selectedNode.prompt).length ? getCommandTokens(selectedNode.prompt).map((code) => <button className="command-chip" key={code} type="button" onClick={() => removeCommand(selectedNode.id, code)} title={`${code} 제거`}>/{code}<span>×</span></button>) : <small className="command-empty">아직 추가한 명령이 없어요</small>}</div>}{selectedNode.type === 'command' && <div className="inspector-command-picker"><div className="field-label">연출 명령 선택</div>{COMMAND_CATEGORIES.map((category) => <details key={category.id}><summary>{category.label}<em>{category.commands.length}개</em></summary><div className="inspector-command-grid">{category.commands.map((command) => <button key={command.code} type="button" onClick={() => appendCommand(selectedNode.id, command.code)}><b>{command.label}</b><small>/{command.code}</small></button>)}</div></details>)}</div>}{(selectedNode.type === 'prompt' || selectedNode.type === 'command' || selectedNode.type === 'motion') ? <><label className="field-label" htmlFor="inspector-prompt">{selectedNode.type === 'motion' ? '모션 지시 프롬프트' : '최종 전달 프롬프트'}</label><textarea id="inspector-prompt" disabled={planning || nodeBusy(selectedNode.id)} className="inspector-textarea" value={selectedNode.prompt || ''} onChange={(event) => setNodes((current) => current.map((item) => item.id === selectedNode.id ? { ...item, prompt: event.target.value } : item))} placeholder={selectedNode.type === 'motion' ? '예: 걷기, 점프, 공격 준비 · 기본 8프레임 GIF' : '이 노드에서 사용할 프롬프트를 입력하세요'}/><div className="inspector-meta"><span>{(selectedNode.prompt || '').length}자</span><span>{selectedNode.type === 'motion' ? (selectedNode.prompt?.trim() ? '프레임별 상세 모션 프롬프트로 보강됨' : '작업 설명 입력 후 프레임별로 보강됨') : '캔버스에 요약 표시됨'}</span></div><div className="inspector-actions"><button className="ghost" disabled={!selectedNode.prompt?.trim()} onClick={() => { void navigator.clipboard?.writeText(selectedNode.prompt || ''); setMessage('프롬프트를 복사했어요'); }}>복사</button><button className="primary" disabled={planning || nodeBusy(selectedNode.id) || (!selectedNode.prompt?.trim() && !request.trim())} onClick={() => void runWorkflow()}>이 노드부터 실행</button></div></> : selectedNode.type === 'edit' ? <EditNodePanel node={selectedNode} busy={planning || nodeBusy(selectedNode.id)} onChange={fields => { if (nodeBusy(selectedNode.id) || planningRef.current) return; setNodes(current => current.map(item => { if (item.id !== selectedNode.id) return item; const updated = { ...item, ...fields }; return { ...updated, title: updated.taskTitle || nodeCatalog.edit.title, subtitle: updated.taskDetail || nodeCatalog.edit.subtitle }; })); }} /> : <div className="inspector-summary"><span>{selectedNode.subtitle}</span><p>이 노드의 입력·출력 포트와 연결 상태를 캔버스에서 조정할 수 있어요.</p></div>}</section>}<CommonStylePanel scope={toolScopeName} style={scopeStyle?.commonStyle} canApply={canApplyStyle} busy={toolScopeBusy} onApply={applyCommonStyle} onClear={clearCommonStyle} /><details className="panel-advanced" open={batchTasks.length > 0}><summary>그룹 관리 · {groups.length}개</summary><GroupPanel compactableIds={compactableGroupIds} groups={groups} selectedGroup={selectedGroup} busy={runState === 'running' || planning} selectionCount={selectionIds.length || (selected === null ? 0 : 1)} tasks={batchTasks} onCreate={createNodeGroup} onSelect={selectToolGroup} onRename={(id, name) => { if (!executionRef.current && !planningRef.current) setGroups(current => current.map(group => group.id === id ? { ...group, name: name.trim() ? name : '그룹' } : group)); }} onUngroup={id => { if (executionRef.current || planningRef.current) return; setNodes(current => current.map(node => node.groupId === id ? { ...node, groupId: undefined } : node)); setGroups(current => current.filter(group => group.id !== id)); setSelectedGroup(null); setMessage('그룹을 해제했어요. 노드와 연결은 유지돼요.'); }} onRun={id => void runWorkflow(id)} onRetry={() => void runWorkflow(undefined, batchTasks.filter(task => task.status === 'error').map(task => task.id))} onCompact={id => void compactCutoutGroup(id)} /></details>{!toolScope.length && <div className="panel-empty"><strong>설정할 작업을 선택하세요</strong><p>작업 만들기에서 플로우를 추가하거나 캔버스의 노드를 선택해 주세요.</p><button className="ghost" onClick={() => setPanelTab('create')}>작업 만들기</button></div>}</div><div id="panel-body-library" role="tabpanel" aria-labelledby="panel-tab-library" hidden={panelTab !== 'library'} className="inspector-tab-body"><TemplatePanel templates={templates} onFavorite={id => { if (!executionRef.current && !planningRef.current) persistTemplates(templates.map(template => template.id === id ? { ...template, favorite: !template.favorite } : template)); }} scope={toolScopeName} canSave={toolScope.length > 0} busy={planning} onSave={saveTemplate} onUse={useTemplate} onDelete={id => { if (!executionRef.current && !planningRef.current && persistTemplates(templates.filter(template => template.id !== id))) setMessage('템플릿을 삭제했어요.'); }} onRename={(id, name) => { if (executionRef.current || planningRef.current || !name.trim()) return false; return persistTemplates(templates.map(template => template.id === id ? { ...template, name: name.trim().slice(0,100) } : template)); }} /><details className="panel-advanced"><summary>프로젝트 백업</summary><div className="project-backup-actions"><button className="ghost" disabled={runState === 'running' || planning} onClick={exportProject}>백업 내보내기</button><button className="ghost" disabled={runState === 'running' || planning} onClick={() => backupInputRef.current?.click()}>백업 가져오기</button><input ref={backupInputRef} hidden type="file" accept="application/json,.json" disabled={runState === 'running' || planning} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importProject(file); event.currentTarget.value = ''; }} /></div></details><button className="ghost panel-results-link" onClick={() => { setOpenedResultFolder(null); setActiveView('results'); }}>결과 폴더 열기 · {resultCount}개</button></div></aside></div>}{viewerImage && <div className="image-viewer" role="dialog" aria-modal="true" aria-label="생성 이미지 크게 보기" onClick={() => setViewerImage(null)}><div className="image-viewer-panel" onClick={(event) => event.stopPropagation()}><div className="image-viewer-head"><strong>{viewerImage.name}</strong><button className="ghost" onClick={() => setViewerImage(null)}>닫기</button></div><img src={viewerImage.url} alt={viewerImage.name} /><button className="primary" onClick={() => { const link = document.createElement('a'); link.href = viewerImage.url; link.download = `gpt-image-${viewerImage.id}.png`; document.body.appendChild(link); link.click(); link.remove(); }}>⬇ 이미지 다운로드</button><button className="ghost" onClick={() => reuseImage(viewerImage.url, viewerImage.name)}>＋ 이 이미지를 입력 이미지로 재사용</button></div></div>}{deviceAuth && <div className="device-auth-backdrop" role="dialog" aria-modal="true" aria-labelledby="device-auth-title"><div className="device-auth-card"><button className="device-auth-close" aria-label="로그인 화면 닫기" onClick={() => setDeviceAuth(null)}>×</button><div className="device-auth-icon">⌘</div><span className="eyebrow">계정 연결 · 보안 인증</span><h2 id="device-auth-title">이 화면에서 인증을 확인하세요</h2><p className="device-auth-copy">새 창의 공식 인증 페이지에서 아래 코드를 입력하면 이 작업실에서 로그인 상태를 자동으로 확인합니다.</p><div className="device-auth-code-label">내 계정 연결 코드</div><div className={`device-auth-code device-auth-${deviceAuth.status}`}>{deviceAuth.userCode}</div><div className="device-auth-actions">{deviceAuth.verificationUrl ? <button className="primary" onClick={() => window.open(deviceAuth.verificationUrl, '_blank', 'noopener,noreferrer')}>공식 인증 페이지 열기 ↗</button> : <button className="primary" disabled>인증 코드 준비 중…</button>}<button className="ghost" disabled={!deviceAuth.userCode || deviceAuth.userCode === '코드 준비 중'} onClick={() => { void navigator.clipboard?.writeText(deviceAuth.userCode); setMessage('인증 코드를 복사했어요'); }}>코드 복사</button></div><div className="device-auth-status"><span className={`device-auth-dot device-auth-dot-${deviceAuth.status}`} />{deviceAuth.status === 'preparing' ? '인증 코드를 준비 중이에요' : deviceAuth.status === 'waiting' ? '인증 대기 중 · 이 창을 닫지 않아도 돼요' : deviceAuth.status === 'authenticated' ? '인증 완료 · 작업실을 사용할 수 있어요' : deviceAuth.status === 'expired' ? '코드가 만료됐어요. 다시 로그인해 주세요' : '인증을 시작하지 못했어요'}</div><div className="device-auth-safe">로그인 정보는 테스트 서버의 사용자별 세션에 보관됩니다. 서버를 재시작하면 다시 연결해야 합니다.</div></div></div>}</main>;
}
