'use client';

import type { StudioGroup } from './studio-groups';

export type BatchTask = { id: number | string; name: string; status: 'waiting' | 'running' | 'done' | 'error'; message?: string };
export function GroupPanel(props: {
  groups: readonly StudioGroup[]; selectedGroup: string | null; busy: boolean; selectionCount: number;
  tasks: readonly BatchTask[];
  compactableIds: readonly string[];
  onCreate: () => void; onSelect: (id: string | null) => void;
  onRename: (id: string, name: string) => void; onUngroup: (id: string) => void; onRun: (id: string) => void; onRetry: () => void; onCompact: (id: string) => void;
}) {
  return <section className="group-panel" aria-label="여러 이미지와 그룹">
    <div className="group-panel-heading"><strong>노드 그룹</strong><button className="ghost" disabled={props.busy || !props.selectionCount} onClick={props.onCreate}>선택 묶기</button></div>
    <details className="panel-help"><summary>그룹 사용법</summary><p>노드 체크박스로 여러 노드를 선택해 묶으세요. 연결된 체인은 함께 묶이고, 그룹 제목을 드래그하면 함께 이동해요.</p></details>
    {props.selectedGroup && <button className="ghost" disabled={props.busy} onClick={() => props.onSelect(null)}>그룹 선택 해제</button>}
    {props.groups.map(group => <div className={`group-list-entry ${props.selectedGroup === group.id ? 'active' : ''}`} key={group.id}>
      <input aria-label={`${group.name} 그룹 이름`} value={group.name} maxLength={100} disabled={props.busy} onChange={event => props.onRename(group.id, event.target.value)} />
      <div className="group-actions"><button className="ghost" disabled={props.busy} onClick={() => props.onSelect(group.id)}>그룹 선택</button><button className="primary" disabled={props.busy} onClick={() => props.onRun(group.id)}>그룹 실행</button><button className="ghost" disabled={props.busy} onClick={() => props.onUngroup(group.id)}>그룹 해제</button></div>
      {props.compactableIds.includes(group.id) && <button className="ghost" disabled={props.busy} onClick={() => props.onCompact(group.id)}>기존 누끼를 공통 플로우로</button>}
    </div>)}
    {props.tasks.length > 0 && <div className="batch-tasks" aria-live="polite"><strong>사진별 실행 상태</strong>{props.tasks.map(task => <div key={task.id} className={`batch-task task-${task.status}`}><span>{task.name}</span><small>{({waiting:'대기',running:'처리 중',done:'완료',error:'실패'})[task.status]}</small>{task.message && <p>{task.message}</p>}</div>)}{props.tasks.some(task => task.status === 'error') && <button className="ghost" disabled={props.busy} onClick={props.onRetry}>실패한 사진만 다시 실행</button>}</div>}
  </section>;
}
