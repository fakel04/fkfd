'use client';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { fitCount, type FitEntry } from './card-fit';

/**
 * Trims a board card's task list to the shared height budget (see card-fit.ts).
 * Rows are marked `data-fit`, «Сегодня» date headings `data-fit-head`, captions `data-fit-caption`.
 * Overflowing rows are hidden in the DOM after measuring their real line count, before paint.
 */
export function FitTasks({children,total,watch,more}:{children:ReactNode;total:number;watch:string;more:(hidden:number)=>ReactNode}){
 const root=useRef<HTMLDivElement>(null);
 const [shown,setShown]=useState(total);
 useLayoutEffect(()=>{
  const element=root.current;if(!element)return;
  const fit=()=>{
   const nodes=[...element.querySelectorAll<HTMLElement>('[data-fit],[data-fit-head]')];
   for(const node of nodes)node.style.display='';
   const entries:FitEntry[]=nodes.map(node=>{
    if(node.hasAttribute('data-fit-head'))return {heading:true};
    const label=node.querySelector<HTMLElement>('.task-label');
    const lineHeight=label?parseFloat(getComputedStyle(label).lineHeight)||20:20;
    const lines=label?Math.max(1,Math.round(label.getBoundingClientRect().height/lineHeight)):1;
    return {lines,caption:!!node.querySelector('[data-fit-caption]')};
   });
   const count=fitCount(entries);
   nodes.forEach((node,index)=>{if(index>=count)node.style.display='none'});
   // A «Сегодня» day whose tasks are all hidden is hidden with its heading.
   for(const section of element.querySelectorAll<HTMLElement>('[data-fit-section]'))
    section.style.display=[...section.querySelectorAll<HTMLElement>('[data-fit]')].some(row=>row.style.display!=='none')?'':'none';
   setShown(entries.slice(0,count).filter(entry=>!entry.heading).length);
  };
  fit();
  let width=element.clientWidth;
  const observer=new ResizeObserver(()=>{if(element.clientWidth!==width){width=element.clientWidth;fit()}});
  observer.observe(element);
  return()=>observer.disconnect();
 },[watch]);
 return <div ref={root} className="fit-tasks">{children}{total>shown&&more(total-shown)}</div>;
}
