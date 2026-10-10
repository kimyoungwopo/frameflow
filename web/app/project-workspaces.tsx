'use client';

import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { createPortal } from 'react-dom';

export type WorkspaceProject = { readonly id: string; readonly name: string };
type WorkspaceStatus = WorkspaceProject & { readonly busy: boolean };
export type WorkspaceNavigation = {
  readonly open: (project: WorkspaceProject) => void;
  readonly create: () => void;
  readonly update: (project: WorkspaceStatus) => void;
  readonly isBusy: (id: string) => boolean;
  readonly deleted: (id: string) => void;
};
export type WorkspaceProps = {
  readonly initialProjectId?: string;
  readonly active?: boolean;
  readonly navigation?: WorkspaceNavigation;
  readonly backgroundProjects?: readonly WorkspaceProject[];
};
type Session = {
  readonly key: string;
  readonly projectId?: string;
  readonly name: string;
  readonly busy: boolean;
  readonly container: HTMLDivElement;
};

export function ProjectWorkspaces({ Workspace }: { readonly Workspace: ComponentType<WorkspaceProps> }) {
  const [sessions, setSessions] = useState<readonly Session[]>([]);
  const [activeKey, setActiveKey] = useState('initial');
  const viewport = useRef<HTMLDivElement | null>(null);
  const currentSessions = useRef(sessions);
  currentSessions.current = sessions;
  useEffect(() => {
    setSessions([{ key: 'initial', name: '작업실', busy: false, container: document.createElement('div') }]);
  }, []);
  useEffect(() => {
    const session = sessions.find(item => item.key === activeKey);
    if (session && viewport.current?.firstElementChild !== session.container) viewport.current?.replaceChildren(session.container);
  }, [activeKey, sessions]);

  const open = (project: WorkspaceProject) => {
    const existing = currentSessions.current.find(item => item.projectId === project.id);
    if (existing) { setActiveKey(existing.key); return; }
    const key = crypto.randomUUID();
    setSessions(current => [...current, { key, projectId: project.id, name: project.name, busy: false, container: document.createElement('div') }]);
    setActiveKey(key);
  };

  return <>
    <div ref={viewport} />
    {!sessions.length && <p role="status">작업실을 준비하고 있어요…</p>}
    {sessions.map(session => createPortal(<Workspace
      initialProjectId={session.projectId}
      active={session.key === activeKey}
      backgroundProjects={sessions.filter(item => item.busy && item.key !== session.key && item.projectId).map(item => ({ id: item.projectId || '', name: item.name }))}
      navigation={{
        open,
        create: () => open({ id: crypto.randomUUID(), name: '빈 작업실' }),
        update: project => setSessions(current => {
          const existing = current.find(item => item.key === session.key);
          if (!existing || (existing.projectId === project.id && existing.name === project.name && existing.busy === project.busy)) return current;
          return current.map(item => item.key === session.key ? { ...item, projectId: project.id, name: project.name, busy: project.busy } : item);
        }),
        isBusy: id => currentSessions.current.some(item => item.projectId === id && item.busy),
        deleted: id => setSessions(current => current.filter(item => item.projectId !== id || item.key === activeKey)),
      }}
    />, session.container, session.key))}
  </>;
}
