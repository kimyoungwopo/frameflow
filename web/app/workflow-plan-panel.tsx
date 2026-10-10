'use client';
import { orderWorkflow } from './workflow-engine';
import type { NodeType, WorkflowEdge } from './workflow-engine';

type Step = { readonly id: number; readonly type: NodeType; readonly title: string; readonly taskDetail?: string; readonly taskTitle?: string };
const kinds: Readonly<Record<string, string>> = { image: '입력', prompt: '작업 지시', command: '연출 명령', generate: '이미지 생성', edit: '이미지 편집', blend: '이미지 합성', upscale: '선명도 개선', repeat: '반복 개선', motion: '스프라이트 모션', preview: '최종 결과' };
export function WorkflowPlanPanel({ nodes, edges, busy, onSelect }: { readonly nodes: readonly Step[]; readonly edges: readonly WorkflowEdge[]; readonly busy: boolean; readonly onSelect: (id: number) => void }) {
  const ids = new Set(nodes.map(node => node.id));
  const steps = orderWorkflow(nodes, edges.filter(edge => ids.has(edge.source) && ids.has(edge.target))).flatMap(item => nodes.filter(node => node.id === item.id && node.taskTitle));
  if (!steps.length) return null;
  return <details className="panel-advanced"><summary>작업 단계 · {steps.length}개</summary><ol className="planned-steps">{steps.map(node => <li key={node.id}><button type="button" disabled={busy} onClick={() => onSelect(node.id)}><span className="planned-step-kind">{kinds[node.type]}</span><strong>{node.title}</strong><p>{node.taskDetail}</p></button></li>)}</ol></details>;
}
