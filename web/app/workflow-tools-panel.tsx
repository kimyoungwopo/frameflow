'use client';
import { useEffect, useState } from 'react';
import { DEFAULT_STYLE, STYLE_OPTIONS, VISUAL_TASKS, parseStyle } from './workflow-tools';
import type { CommonStyle, VisualTaskId, WorkflowTemplate } from './workflow-tools';
import { DesignedSelect } from './designed-select';

export function VisualTaskCards(props: { busy: boolean; onChoose: (id: VisualTaskId) => void }) {
  return <section className="visual-tasks" aria-label="효과로 고르는 작업"><div className="tools-section-heading"><strong>효과로 작업 선택</strong><small>새 공통 플로우 만들기</small></div><div className="visual-task-list">{VISUAL_TASKS.map(task => <button key={task.id} className="visual-task-card" disabled={props.busy} onClick={() => props.onChoose(task.id)}><span className="task-example-pair" aria-hidden="true"><span className="task-example before"><span className="task-example-swatch" /><span>원본</span></span><span className={`task-example after ${task.visual}`}><span className="task-example-swatch" /><span>효과 예시</span></span></span><span className="visual-task-copy"><strong>{task.title}</strong><small>{task.description}</small></span></button>)}</div><p className="tools-note">AI 예시 이미지예요. 실제 결과는 입력 사진과 생성 모델에 따라 달라요.</p></section>;
}
export function TemplatePanel(props: { templates: readonly WorkflowTemplate[]; scope: string; canSave: boolean; busy: boolean; onSave: (name: string) => boolean; onUse: (template: WorkflowTemplate) => void; onDelete: (id: string) => void; onFavorite: (id: string) => void; onRename: (id: string, name: string) => boolean }) {
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [query, setQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const shown = props.templates.filter(template => (!favoritesOnly || template.favorite) && template.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a,b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
  return <section className="workflow-tool-section" aria-label="내 작업 템플릿">
    <div className="tools-section-heading"><h3>내 작업 템플릿</h3><small>{props.templates.length}개</small></div>
    <form className="template-save-form" onSubmit={event => { event.preventDefault(); if (props.onSave(name)) setName(''); }}><label>템플릿 이름<input aria-label="새 템플릿 이름" maxLength={100} value={name} disabled={props.busy} onChange={event => setName(event.target.value)} placeholder="예: 쇼핑몰 제품 누끼" /></label><button className="primary" disabled={props.busy || !props.canSave || !name.trim()}>템플릿 저장</button></form>
    <details className="panel-help"><summary>저장 안내</summary><p>{props.scope}의 구조와 설정을 이 브라우저에 저장합니다. 입력 이미지와 결과는 포함하지 않아요.</p></details>
    <div className="template-search"><label>템플릿 검색<input aria-label="템플릿 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="이름으로 찾기" /></label><button type="button" className="ghost" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(current => !current)}>즐겨찾기만</button></div>
    <div className="template-list">{shown.map(template => <article key={template.id}>{renaming === template.id ? <form onSubmit={event => { event.preventDefault(); if (props.onRename(template.id, rename)) setRenaming(null); }}><label>새 이름<input aria-label="템플릿 이름 변경" value={rename} maxLength={100} onChange={event => setRename(event.target.value)} disabled={props.busy} /></label><button className="ghost" disabled={props.busy || !rename.trim()}>이름 저장</button><button className="ghost" type="button" onClick={() => setRenaming(null)}>취소</button></form> : <><div className="template-entry-head"><strong>{template.name}</strong><button className="favorite-button" aria-label={`${template.name} 즐겨찾기`} aria-pressed={Boolean(template.favorite)} disabled={props.busy} onClick={() => props.onFavorite(template.id)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" /></svg></button></div><small>{template.nodes.length}개 도구 · 이미지만 교체해 재사용</small><div className="template-actions"><button className="primary" disabled={props.busy} onClick={() => props.onUse(template)}>캔버스에 추가</button><button className="ghost" disabled={props.busy} onClick={() => { setRenaming(template.id); setRename(template.name); }}>이름 변경</button><button className="ghost danger-action" disabled={props.busy} onClick={() => props.onDelete(template.id)}>삭제</button></div></>}</article>)}</div>
    {!shown.length && <p className="tools-note">{props.templates.length ? '검색 조건에 맞는 템플릿이 없어요.' : '자주 쓰는 플로우를 저장해 두세요.'}</p>}
  </section>;
}
export function CommonStylePanel(props: { scope: string; style: CommonStyle | undefined; canApply: boolean; busy: boolean; onApply: (style: CommonStyle) => void; onClear: () => void }) {
  const [style, setStyle] = useState<CommonStyle>(props.style || DEFAULT_STYLE);
  useEffect(() => { setStyle(props.style || DEFAULT_STYLE); }, [props.scope, props.style]);
  const dirty = JSON.stringify(style) !== JSON.stringify(props.style || DEFAULT_STYLE);
  return <section className="workflow-tool-section" aria-label="공통 스타일">
    <div className="tools-section-heading"><h3>공통 스타일</h3><small>{dirty ? '변경됨 · 적용 필요' : props.style ? '적용 중' : '선택 사항'}</small></div>
    {!props.canApply && <p className="tools-note">스타일을 적용할 그룹이나 노드를 선택하세요.</p>}
    <div className="common-style-fields">{(Object.keys(STYLE_OPTIONS) as (keyof CommonStyle)[]).map(key => <div className="style-choice-field" key={key}><span>{({ background: '배경', lighting: '조명', tone: '색감', ratio: '구도 비율' })[key]}</span><DesignedSelect label={`공통 스타일 ${({background:'배경',lighting:'조명',tone:'색감',ratio:'구도 비율'})[key]}`} value={style[key]} disabled={props.busy || !props.canApply} onChange={value => setStyle(current => parseStyle({ ...current, [key]: value }))} options={Object.entries(STYLE_OPTIONS[key]).map(([value, label]) => ({ value, label }))} /></div>)}</div>
    <div className="template-actions"><button className="primary" disabled={props.busy || !props.canApply} onClick={() => props.onApply(style)}>스타일 적용</button><button className="ghost" disabled={props.busy || !props.style} onClick={props.onClear}>해제</button></div>
    <details className="panel-help"><summary>적용 안내</summary><p>{props.scope}에 같은 스타일 지시를 적용해요. 비율은 생성 구도에 대한 지시이며 정확한 픽셀 크기와 이미지 간 완전한 일치는 보장되지 않아요.</p></details>
  </section>;
}
