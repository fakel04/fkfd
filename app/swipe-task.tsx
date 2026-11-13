'use client';
import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { MoreHorizontal, Pin, PinOff, Cloud, ListChecks, X } from 'lucide-react';
import {clampSwipe,settleSwipe} from './swipe-offset';

export function SwipeTask({children, label, pinned, focused, disabled, showMenuButton=true, onPin, onCloud, onFocus, onMore, onDelete}: {
 children:ReactNode; label:string; pinned?:boolean; focused?:boolean; disabled?:boolean; showMenuButton?:boolean;
 onPin:()=>void; onCloud:()=>void; onFocus:()=>void; onMore:()=>void;
 onDelete?:()=>void;
}) {
 const root=useRef<HTMLDivElement>(null);
 const [offset,setOffset]=useState(0); const [moving,setMoving]=useState(false);
 const gesture=useRef<{id:number;x:number;y:number;base:number;dx:number;horizontal:boolean}|null>(null);
 const suppress=useRef(false);
 const width=()=>Math.min(176,(root.current?.clientWidth||300)*.85);
 const moreWidth=()=>Math.min(88,(root.current?.clientWidth||300)*.5);
 function close(){setOffset(0);setMoving(false);gesture.current=null;}
 useEffect(()=>{
  const outside=(e:globalThis.PointerEvent)=>{if(!root.current?.contains(e.target as Node))close()};
  const other=(e:Event)=>{if((e as CustomEvent).detail!==root.current)close()};
  document.addEventListener('pointerdown',outside);document.addEventListener('task-swipe-open',other);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('task-swipe-open',other)};
 },[]);
 function start(e:PointerEvent){
  if(disabled||!e.isPrimary||e.button!==0||(e.target as HTMLElement).closest('button,a,select,.drag-handle'))return;
  suppress.current=false;gesture.current={id:e.pointerId,x:e.clientX,y:e.clientY,base:offset,dx:0,horizontal:false};
 }
 function move(e:PointerEvent){
  const g=gesture.current;if(!g||g.id!==e.pointerId)return;
  const dx=e.clientX-g.x,dy=e.clientY-g.y;
  if(!g.horizontal){
   if(Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){gesture.current=null;return;}
   if(Math.abs(dx)<10||Math.abs(dx)<Math.abs(dy)*1.3)return;
   g.horizontal=true;setMoving(true);suppress.current=true;
   e.currentTarget.setPointerCapture(e.pointerId);
   document.dispatchEvent(new CustomEvent('task-swipe-open',{detail:root.current}));
  }
  e.preventDefault();g.dx=dx;setOffset(clampSwipe(g.base+dx,width(),moreWidth()));
 }
 function end(e:PointerEvent){
  const g=gesture.current;if(!g||g.id!==e.pointerId)return;
  gesture.current=null;setMoving(false);
  if(g.horizontal){setOffset(settleSwipe(g.base+g.dx,width(),moreWidth()));e.preventDefault();}
  if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
 }
 function action(fn:()=>void){close();fn()}
 return <div ref={root} className={'swipe-task'+(offset?' swipe-open':'')} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();close()}}}>
  {!disabled&&<>
   <div className="swipe-actions swipe-left" style={{width:width(),visibility:offset>0?'visible':'hidden'}} inert={offset<=0}>
    <button type="button" onClick={()=>action(onPin)}>{pinned?<PinOff/>:<Pin/>}<span>{pinned?'Открепить':'Закрепить'}</span></button>
    <button type="button" onClick={()=>action(focused?onCloud:onFocus)}>{focused?<Cloud/>:<ListChecks/>}<span>{focused?'В облако':'В задачи'}</span></button>
   </div>
   <div className="swipe-actions swipe-right" style={{width:moreWidth(),visibility:offset<0?'visible':'hidden'}} inert={offset>=0}>
    <button type="button" aria-label={'Ещё: '+label} onClick={()=>action(onMore)}><MoreHorizontal/><span>Ещё</span></button>
   </div>
  </>}
  <div className={'swipe-content'+(!showMenuButton?' no-task-menu':'')+(!disabled&&onDelete?' has-task-delete':'')+(moving?' swiping':'')} style={{transform:`translateX(${offset}px)`}}
   onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={close}
   onClickCapture={e=>{if(suppress.current){e.preventDefault();e.stopPropagation();suppress.current=false;}else if(offset){e.preventDefault();e.stopPropagation();close();}}}>
   {children}
   {!disabled&&onDelete&&<button type="button" className="task-delete-trigger" title="Удалить дело" aria-label={'Удалить дело: '+(label||'Без названия')} onClick={e=>{e.stopPropagation();action(onDelete)}}><X size={16}/></button>}
   {!disabled&&showMenuButton&&<button type="button" className="task-menu-trigger" aria-label={'Действия: '+label} onClick={e=>{e.stopPropagation();action(onMore)}}><MoreHorizontal size={16}/></button>}
  </div>
 </div>;
}
