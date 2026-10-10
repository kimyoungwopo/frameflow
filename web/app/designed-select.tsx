'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Choice<T extends string> = { value: T; label: string; description?: string };
export function DesignedSelect<T extends string>(props: { label: string; value: T; options: readonly Choice<T>[]; disabled?: boolean; onChange: (value: T) => void }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 220, height: 260 });
  const selected = props.options.findIndex(option => option.value === props.value);
  const show = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect || props.disabled || !props.options.length) return;
    const width = Math.min(Math.max(rect.width, 230), window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const upwards = below < 180 && above > below;
    const height = Math.min(280, upwards ? above : below);
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: upwards ? rect.top - height - 6 : rect.bottom + 6, width, height });
    setActive(Math.max(0, selected)); setOpen(true);
  };
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };
  const choose = (index: number) => { const option = props.options[index]; if (!option) return; props.onChange(option.value); close(true); };
  useEffect(() => { if (props.disabled) setOpen(false); }, [props.disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    const moved = (event: Event) => { if (event.target instanceof Node && menu.current?.contains(event.target)) return; setOpen(false); };
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', moved); window.addEventListener('scroll', moved, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', moved); window.removeEventListener('scroll', moved, true); };
  }, [open]);
  useEffect(() => { if (open) menu.current?.querySelector(`[id="${id}-option-${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [open, active, id]);
  return <div className="designed-select"><button ref={trigger} type="button" role="combobox" aria-label={props.label} aria-expanded={open} aria-haspopup="listbox" aria-controls={`${id}-menu`} aria-activedescendant={open ? `${id}-option-${active}` : undefined} disabled={props.disabled} className={`designed-select-trigger ${open ? 'is-open' : ''}`} onClick={() => open ? close() : show()} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') close();
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open) show(); else setActive(current => (current + (event.key === 'ArrowDown' ? 1 : -1) + props.options.length) % props.options.length); }
    else if (open && (event.key === 'Home' || event.key === 'End')) { event.preventDefault(); setActive(event.key === 'Home' ? 0 : props.options.length - 1); }
    else if (open && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); choose(active); }
  }}><span>{props.options[selected]?.label || '선택해 주세요'}</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></button>{open && createPortal(<div ref={menu} id={`${id}-menu`} role="listbox" aria-label={props.label} className="designed-select-menu" style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.height }}>{props.options.map((option, index) => <button id={`${id}-option-${index}`} type="button" role="option" tabIndex={-1} aria-selected={option.value === props.value} key={option.value} className={`designed-select-option ${active === index ? 'is-active' : ''}`} onPointerMove={() => setActive(index)} onClick={() => choose(index)}><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>{option.value === props.value && <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>}</button>)}</div>, document.body)}</div>;
}
