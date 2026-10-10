'use client';
import { useState } from 'react';

export type FlowEditReview = { readonly scope: string; readonly instruction: string; readonly summary: string; readonly warnings: readonly string[]; readonly requests: number; readonly diff: { readonly added: number; readonly removed: number; readonly changed: number }; readonly steps: readonly { readonly id: number; readonly taskTitle?: string; readonly taskDetail?: string; readonly type: string }[] };
type Props = { readonly scope: string; readonly canEdit: boolean; readonly busy: boolean; readonly requesting: boolean; readonly review: FlowEditReview | null; readonly canUndo: boolean; readonly hasUndo: boolean; readonly onSubmit: (instruction: string) => void; readonly onApply: () => void; readonly onDiscard: () => void; readonly onUndo: () => void; readonly onCancel: () => void };
export function WorkflowEditPanel({ scope, canEdit, busy, requesting, review, canUndo, hasUndo, onSubmit, onApply, onDiscard, onUndo, onCancel }: Props) {
  const [instruction, setInstruction] = useState('');
  return <section className="flow-edit-panel" aria-label="자연어로 기존 플로우 수정">
    <div className="flow-edit-heading"><h3>플로우 수정</h3><small>{review?.scope || scope}</small></div>
    {!canEdit && <p className="tools-note">수정할 그룹이나 노드를 선택하세요.</p>}
    <label className="field-label" htmlFor="flow-edit-request">어떻게 바꿀까요?</label>
    <textarea id="flow-edit-request" maxLength={4000} disabled={busy || Boolean(review)} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="예: 배경 변경 뒤에 조명 단계를 추가해줘." />
    <div className="panel-action-row"><button type="button" className="primary" disabled={!canEdit || busy || Boolean(review) || !instruction.trim()} onClick={() => onSubmit(instruction)}>{requesting ? '수정안 구성 중…' : '수정안 만들기'}</button>{requesting && <button type="button" className="ghost" onClick={onCancel}>취소</button>}</div>
    {review && <div className="flow-edit-review" aria-label="플로우 수정안" aria-live="polite">
      <strong>적용 전 수정안</strong>
      <div className="flow-edit-counts"><span>추가 {review.diff.added}</span><span>수정 {review.diff.changed}</span><span>삭제 {review.diff.removed}</span></div>
      <p className="request-estimate">적용 후 예상 요청 {review.requests}회</p>
      <details className="panel-help"><summary>변경 내용 · {review.steps.length}단계</summary><p>{review.summary}</p><ol className="flow-edit-steps">{review.steps.map(step => <li key={step.id}><strong>{step.taskTitle || step.type}</strong><p>{step.taskDetail}</p></li>)}</ol></details>
      {review.warnings.map((warning,index) => <p className="tools-note" key={index}>{warning}</p>)}
      <div className="flow-edit-actions"><button type="button" className="primary" disabled={busy} onClick={onApply}>수정안 적용</button><button type="button" className="ghost" disabled={busy} onClick={onDiscard}>버리기</button></div>
    </div>}
    {hasUndo && <><button type="button" className="ghost" disabled={busy || !canUndo || Boolean(review)} onClick={onUndo}>수정 되돌리기</button>{!canUndo && <p className="tools-note">추가 변경이 있어 되돌릴 수 없어요.</p>}</>}
    <details className="panel-help"><summary>수정 안내</summary><p>선택한 플로우의 단계와 배치를 수정합니다. 입력 사진과 이전 결과 폴더는 보존해요. 다른 플로우와 연결된 그룹은 연결 전체를 선택하세요.</p>{review && <p>요청: {review.instruction}</p>}</details>
  </section>;
}
