'use client';

import { useEffect, useRef, useState } from 'react';
import { localBridgeFetch } from './local-bridge';

type Props = { onClose: () => void; onReady: () => Promise<void>; onAdvanced: () => void };
export function BridgeSetup({ onClose, onReady, onAdvanced }: Props) {
  const [phase, setPhase] = useState<'checking' | 'unavailable' | 'ready'>('checking');
  const [starting, setStarting] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  async function check(signal?: AbortSignal) {
    try {
      const response = await localBridgeFetch('/status', { signal: signal || AbortSignal.timeout(2500) });
      const data = await response.json();
      if (signal?.aborted) return;
      if (response.ok && data.bridge === 'gpt-node-studio-bridge') setPhase('ready');
      else setPhase('unavailable');
    } catch { if (!signal?.aborted || signal.reason?.name === 'TimeoutError') setPhase('unavailable'); }
  }
  useEffect(() => {
    closeRef.current?.focus();
    const controller = new AbortController();
    void check(AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]));
    return () => controller.abort();
  }, []);
  return <div className="device-auth-backdrop" role="dialog" aria-modal="true" aria-labelledby="bridge-setup-title" onKeyDown={event => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Tab') {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), select'));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}><section className="device-auth-card bridge-setup-card">
    <button ref={closeRef} className="device-auth-close" aria-label="자동 설정 닫기" onClick={onClose}>×</button>
    <h2 id="bridge-setup-title">내 계정으로 시작하기</h2>
    <p>GPT 계정은 본인 컴퓨터에서 연결합니다. 소스가 포함된 설정 파일은 배포하지 않습니다.</p>
    {phase === 'checking' ? <p role="status">이 컴퓨터의 연결 상태를 확인하고 있어요…</p> : phase === 'ready' ? <>
      <p className="bridge-setup-ready" role="status">이 컴퓨터가 연결됐어요. 주소와 연결 키 입력은 필요 없어요.</p>
      <button className="primary" disabled={starting} onClick={async () => { setStarting(true); onClose(); await onReady(); }}>GPT 계정 연결하기</button>
    </> : <>
      <div className="bridge-setup-instructions" role="status"><strong>현재 설정 파일 배포가 중단되어 있습니다.</strong><p>소스 보호를 위해 새 컴퓨터의 자동 설정을 제공하지 않습니다. 기존 Bridge가 실행 중이라면 연결 상태를 다시 확인할 수 있습니다.</p><button className="ghost" onClick={() => { setPhase('checking'); void check(); }}>연결 다시 확인</button></div>
    </>}
    <button className="ghost" onClick={() => { onClose(); onAdvanced(); }}>직접 연결 설정</button>
  </section></div>;
}
