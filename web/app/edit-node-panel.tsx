type EditNodeFields = {
  readonly prompt?: string;
  readonly taskTitle?: string;
  readonly taskDetail?: string;
};

type EditNodePanelProps = {
  readonly node: EditNodeFields;
  readonly busy: boolean;
  readonly onChange: (fields: EditNodeFields) => void;
};

export function EditNodePanel({ node, busy, onChange }: EditNodePanelProps) {
  return <div className="edit-node-fields">
    <label className="edit-node-field" htmlFor="edit-node-prompt">
      <span className="field-label">이미지 편집 지시</span>
      <textarea id="edit-node-prompt" className="inspector-textarea" disabled={busy} value={node.prompt || ''} maxLength={10000} onChange={event => onChange({ prompt: event.target.value })} placeholder="예: 얼굴과 의상은 유지하고 배경을 자연스러운 거리로 바꿔 주세요. 글자는 넣지 마세요." />
    </label>
    <p className="panel-context-hint">이 단계에 적용돼요. 연결된 프롬프트가 있으면 함께 전달돼요.</p>
    <details className="panel-help">
      <summary>노드 이름·설명</summary>
      <div className="edit-node-metadata">
        <label className="edit-node-field" htmlFor="edit-node-title">
          <span className="field-label">노드 이름</span>
          <input id="edit-node-title" disabled={busy} value={node.taskTitle || ''} maxLength={60} onChange={event => onChange({ taskTitle: event.target.value })} placeholder="이미지 편집" />
        </label>
        <label className="edit-node-field" htmlFor="edit-node-detail">
          <span className="field-label">노드 설명</span>
          <textarea id="edit-node-detail" disabled={busy} value={node.taskDetail || ''} maxLength={300} onChange={event => onChange({ taskDetail: event.target.value })} placeholder="캔버스에 표시할 작업 설명" />
        </label>
        <p className="panel-context-hint">이름·설명은 캔버스에 표시돼요. 편집할 내용은 위에 입력해 주세요.</p>
      </div>
    </details>
  </div>;
}
