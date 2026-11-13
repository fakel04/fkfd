'use client';

import { useLayoutEffect, useRef } from 'react';

/** Persist the change immediately; only the visual copy flies to the completed section. */
export function useTaskCompletionMotion(version: unknown) {
  const container = useRef<HTMLDivElement>(null);
  const pending = useRef<{ ghost: HTMLElement; from: DOMRect; positions: Map<Element, DOMRect> } | null>(null);
  const effects = useRef(new Set<() => void>());

  function prepare(id: string, completing: boolean) {
    const host = container.current;
    if (!host || !completing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rows = [...host.querySelectorAll<HTMLElement>('[data-editor-task-id]')];
    const row = rows.find(item => item.dataset.editorTaskId === id);
    if (!row) return;
    const from = row.getBoundingClientRect();
    const ghost = row.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('data-editor-task-id');
    ghost.classList.add('completion-flight', 'done');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    ghost.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    const checkbox = ghost.querySelector('[role="checkbox"]');
    checkbox?.setAttribute('aria-checked', 'true');
    ghost.style.cssText = `position:fixed;left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;margin:0;z-index:1000;pointer-events:none;transform-origin:left center;`;
    const panel = host.closest('.modal-panel');
    if (panel) ghost.style.backgroundColor = getComputedStyle(panel).backgroundColor;
    document.body.appendChild(ghost);
    pending.current?.ghost.remove();
    pending.current = { ghost, from, positions: new Map([...rows, ...host.querySelectorAll('.editor-completed')].map(element => [element, element.getBoundingClientRect()])) };
  }

  useLayoutEffect(() => {
    const flight = pending.current;
    pending.current = null;
    if (!flight) return;
    const { ghost, from, positions } = flight;
    const animations: Animation[] = [];
    const target = container.current?.querySelector('.editor-completed-toggle');
    const destination = target?.getBoundingClientRect();
    const dy = destination ? destination.top + destination.height / 2 - from.top - from.height / 2 : 100;
    const dx = destination ? destination.left - from.left : 0;
    for (const [element, before] of positions) {
      if (!element.isConnected) continue;
      const after = element.getBoundingClientRect();
      const offset = before.top - after.top;
      if (Math.abs(offset) > 1) animations.push(element.animate([
        { transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }
      ], { duration: 440, easing: 'cubic-bezier(.22,1,.36,1)' }));
    }
    const animation = ghost.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
      { transform: 'translate(0,4px) scale(1.01)', opacity: .95, offset: .18 },
      { transform: `translate(${dx}px,${dy}px) scale(.92)`, opacity: .6, offset: .85 },
      { transform: `translate(${dx}px,${dy}px) scale(.88)`, opacity: 0, offset: 1 }
    ], { duration: 560, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    animations.push(animation);
    if (target) animations.push(target.animate([
      { backgroundColor: 'transparent' }, { backgroundColor: '#6d8c5330' }, { backgroundColor: 'transparent' }
    ], { delay: 380, duration: 420, easing: 'ease-out' }));
    const cleanup = () => { ghost.remove(); animations.forEach(item => item.cancel()); effects.current.delete(cleanup); };
    effects.current.add(cleanup);
    Promise.all(animations.map(item => item.finished)).then(cleanup, cleanup);
  }, [version]);

  useLayoutEffect(() => () => {
    pending.current?.ghost.remove();
    effects.current.forEach(cleanup => cleanup());
  }, []);
  return { container, prepare };
}
