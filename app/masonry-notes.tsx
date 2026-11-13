'use client';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Variable-height cards keep their DOM/manual order while packing the next free column. */
export function MasonryNotes({children,layout}:{children:ReactNode;layout:'grid'|'list'}){
 const root=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const grid=root.current;if(!grid)return;
  const cards=Array.from(grid.children) as HTMLElement[];
  if(layout==='list'){delete grid.dataset.masonryReady;cards.forEach(card=>card.style.removeProperty('grid-row-end'));return;}
  let frame=0;
  const measure=()=>{const gap=parseFloat(getComputedStyle(grid).getPropertyValue('--card-gap'))||8;for(const card of cards){const span=Math.ceil(card.getBoundingClientRect().height+gap);const value=`span ${span}`;if(card.style.gridRowEnd!==value)card.style.gridRowEnd=value;}grid.dataset.masonryReady='true';};
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure)};
  measure();const observer=new ResizeObserver(schedule);cards.forEach(card=>observer.observe(card));observer.observe(grid);
  return()=>{observer.disconnect();cancelAnimationFrame(frame)};
 },[children,layout]);
 return <div ref={root} className={'notes-grid '+layout}>{children}</div>;
}
