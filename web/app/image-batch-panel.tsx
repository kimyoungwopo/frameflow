'use client';
import type { StudioImage, BatchOutput } from './shared-flow';
import { DesignedSelect } from './designed-select';

export function ImageBatchPanel(props: { images: readonly StudioImage[]; output: BatchOutput; busy: boolean; onFiles: (files: File[]) => void; onRemove: (id: string) => void; onOutput: (output: BatchOutput) => void; onAssemble: () => void; canAssemble: boolean }) {
  return <section className="image-batch-panel" aria-label="공통 플로우 입력 사진">
    <div className="tools-section-heading"><h3>입력 사진</h3><small>{props.images.length} / 12장</small></div>
    <label className="batch-upload"><input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={props.busy} onChange={event => { props.onFiles(Array.from(event.target.files || [])); event.currentTarget.value = ''; }} /><span>＋ 사진 추가</span><small>여러 장을 한 번에 선택하세요</small></label>
    <div className="batch-input-list">{props.images.map(image => <div key={image.id}><img src={image.url} alt={image.name} /><span>{image.name}</span><button className="ghost" disabled={props.busy} aria-label={`${image.name} 입력에서 빼기`} onClick={() => props.onRemove(image.id)}>빼기</button></div>)}</div>
    <div className="style-choice-field"><span>출력 방식</span><DesignedSelect label="여러 사진 결과 방식" disabled={props.busy} value={props.output} onChange={props.onOutput} options={[{value:'each',label:'각각 출력',description:'이미지마다 별도 파일 · 같은 결과 폴더'},{value:'sheet',label:'한 장에 배치',description:'모든 결과를 하나의 이미지에 정렬'}]} /></div>
    {props.canAssemble && <button className="ghost" disabled={props.busy} onClick={props.onAssemble}>{props.output === 'each' ? '기존 결과를 폴더로 모으기' : '기존 결과로 한 장 만들기'}</button>}
    <details className="panel-help"><summary>출력 안내</summary><p>사진마다 같은 플로우를 실행해요. 각각 출력은 개별 PNG를 한 결과 폴더에 모으고, 한 장에 배치는 결과를 하나의 이미지로 정렬합니다.</p></details>
  </section>;
}
