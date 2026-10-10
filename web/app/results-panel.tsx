'use client';
import { DesignedSelect } from './designed-select';
import { resultZip, safeArchiveName } from './result-zip';
import { useState } from 'react';
import { resultUnits } from './result-folders';
import type { ImageResult } from './result-folders';
import { VISUAL_TASKS } from './workflow-tools';
import type { VisualTaskId } from './workflow-tools';

export function ResultsPanel(props: { history: readonly ImageResult[]; projectId: string; initialFolder?: string | null; busy: boolean; onNext: (images: readonly ImageResult[], task: VisualTaskId) => void; onStudio: () => void; onView: (image: ImageResult) => void; onReuse: (image: ImageResult) => void; onDownload: (image: ImageResult) => void; onRename: (id: string, name: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'recent' | 'project'>('all');
  const [openedId, setOpenedId] = useState<string | null>(props.initialFolder || null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [nextTask, setNextTask] = useState<VisualTaskId>('background');
  const [packing, setPacking] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState('');
  const history = filter === 'project' ? props.history.filter(image => !image.projectId || image.projectId === props.projectId) : props.history;
  const allUnits = resultUnits(history);
  const units = filter === 'recent' ? allUnits.slice(0,4) : allUnits;
  const opened = units.find(unit => unit.folder && unit.id === openedId);
  const images = opened?.images || [];
  const selectedImages = images.filter(image => selectedIds.includes(image.id));
  const changeFolder = (id: string | null) => { setOpenedId(id); setSelectedIds([]); setDownloadNotice(''); };
  const downloadBundle = async () => {
    if (packing || props.busy || !opened?.folder) return;
    setPacking(true); setDownloadNotice('');
    try {
      await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      const chosen = selectedImages.length ? selectedImages : images;
      const zip = resultZip(chosen, opened.folder.name);
      const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
      const link = document.createElement('a'); link.href = url; link.download = safeArchiveName(opened.folder.name) + '.zip'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      setDownloadNotice(chosen.length + '장 ZIP 다운로드를 시작했어요.');
    } catch (error) { setDownloadNotice(error instanceof Error ? error.message : 'ZIP 다운로드를 준비하지 못했어요.'); }
    finally { setPacking(false); }
  };
  const imageCard = (entry: ImageResult) => <article className={`result-card ${selectedIds.includes(entry.id) ? 'result-selected' : ''}`} key={entry.id}>{opened && <label className="result-select"><input type="checkbox" aria-label={`${entry.name} 다음 작업에 선택`} disabled={props.busy} checked={selectedIds.includes(entry.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, entry.id] : current.filter(id => id !== entry.id))} />선택</label>}<button className="result-image-button" aria-label={`${entry.name} 크게 보기`} onClick={() => props.onView(entry)}><img src={entry.url} alt={entry.name} /></button><div className="result-card-body"><div><strong>{entry.name}</strong><small>{new Date(entry.createdAt).toLocaleString('ko-KR')}</small></div><div className="result-file-actions"><button className="ghost" aria-label={`${entry.name} 다운로드`} onClick={() => props.onDownload(entry)}>PNG 다운로드</button><button className="result-menu" disabled={props.busy} onClick={() => props.onReuse(entry)}>입력으로 재사용</button></div></div></article>;
  return <section className="results-page">
    <div className="results-page-head"><div><span className="eyebrow">RESULTS</span><h1>{opened?.folder ? opened.folder.name : '생성 결과'}</h1><p>{opened ? '각 사진의 결과를 따로 확인하고 다운로드하세요.' : '같은 작업에서 나온 이미지를 작업 폴더로 보관해요.'}</p></div><button className="primary" onClick={props.onStudio}>작업실에서 흐름 보기</button></div>
    <div className="results-toolbar"><span>{opened ? `${images.length}개 이미지` : `${units.filter(unit=>unit.folder).length}개 폴더 · ${units.filter(unit=>!unit.folder).length}개 개별 결과`}</span><div>{(['all','recent','project'] as const).map(value => <button key={value} className={filter === value ? 'filter-chip active' : 'filter-chip'} onClick={() => { setFilter(value); changeFolder(null); }}>{({all:'전체 결과',recent:'최근 작업',project:'현재 프로젝트'})[value]}</button>)}</div></div>
    {opened?.folder ? <>
      <div className="result-folder-bar"><button className="ghost" onClick={() => changeFolder(null)}>모든 폴더로</button><label>폴더 이름<input aria-label="결과 폴더 이름" disabled={props.busy} value={opened.folder.name} maxLength={200} onChange={event => props.onRename(opened.id,event.target.value)} /></label></div>
      <div className="result-next-toolbar" aria-label="결과 묶음의 다음 작업"><button className="ghost" disabled={props.busy} onClick={() => setSelectedIds(selectedImages.length === images.length ? [] : images.map(image => image.id))}>{selectedImages.length === images.length ? '선택 해제' : '전체 선택'}</button><span aria-live="polite">{selectedImages.length}장 선택</span><div className="result-task-choice"><span>다음 작업</span><DesignedSelect<VisualTaskId> label="결과 묶음 다음 작업" value={nextTask} disabled={props.busy || packing} onChange={setNextTask} options={VISUAL_TASKS.map(task => ({value:task.id,label:task.title,description:task.description}))} /></div><button className="primary" disabled={props.busy || !selectedImages.length || selectedImages.length > 12} onClick={() => props.onNext(selectedImages, nextTask)}>선택한 결과로 다음 작업 만들기</button><button className="ghost" disabled={props.busy || packing || !images.length} onClick={() => void downloadBundle()}>{packing ? 'ZIP 준비 중…' : selectedImages.length ? `선택한 ${selectedImages.length}장 ZIP 다운로드` : '폴더 전체 ZIP 다운로드'}</button><small>{selectedImages.length > 12 ? '한 번에 12장까지 선택해 주세요.' : '원본 결과를 유지하고 새 공통 플로우에 복사해요. 자동으로 실행하지 않아요.'}</small></div>
      {downloadNotice && <p className="bundle-notice" role="status">{downloadNotice}</p>}
      {images.length < opened.folder.expectedCount && <p className="folder-incomplete">{opened.folder.expectedCount}개 중 {images.length}개 완료 · 작업실에서 실패한 사진만 다시 실행하면 이 폴더에 추가돼요.</p>}
      <div className="results-grid">{images.map(imageCard)}</div>
    </> : units.length ? <div className="results-grid">{units.map(unit => unit.folder ? <article className="result-folder-card" key={unit.id}><button className="result-folder-open" aria-label={`${unit.folder.name} 폴더 열기`} onClick={() => changeFolder(unit.id)}><svg className="result-folder-icon" viewBox="0 0 48 40" aria-hidden="true"><path d="M3 8V5a3 3 0 013-3h13l5 5h18a3 3 0 013 3v25a3 3 0 01-3 3H6a3 3 0 01-3-3z" fill="currentColor" /></svg><div className="result-folder-covers">{unit.images.slice(0,4).map(image => <img key={image.id} src={image.url} alt={image.name} />)}</div><strong>{unit.folder.name}</strong><small>{unit.images.length}개 이미지{unit.images.length < unit.folder.expectedCount ? ` / ${unit.folder.expectedCount}개 중 완료` : ''}</small><span className="result-folder-hint">폴더 열기</span></button></article> : imageCard(unit.images[0]))}</div> : <div className="results-empty"><strong>아직 결과가 없어요</strong><p>Studio에서 작업하면 결과 폴더가 생성돼요.</p><button className="primary" onClick={props.onStudio}>작업 시작하기</button></div>}
  </section>;
}
