'use client';
import {useEffect,useRef,useState,type PointerEvent as ReactPointerEvent,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import {flushSync} from 'react-dom';
import {GripVertical} from 'lucide-react';
import {TaskCheckbox} from './task-checkbox';
import {TaskText} from './task-details';
import {agendaDays,dateLabel,type AgendaGroup} from './today-agenda';
import {taskGhost,pulseTask,reducedMotion} from './task-motion';
import type {Note,Task} from './board-model';

type Target={date:string;beforeId:string|null;top:number;left:number;width:number};
type Gesture={id:string;pointerId:number;startX:number;startY:number;x:number;y:number;handle:HTMLButtonElement;row:HTMLElement;active:boolean;ghost?:ReturnType<typeof taskGhost>;line?:HTMLDivElement;target:Target|null};
type Props={groups:AgendaGroup[];today:string;full:boolean;readOnly:boolean;onMove:(id:string,date:string,beforeId:string|null)=>void;onToggle:(note:Note,task:Task)=>void;onOpen:(note:Note)=>void};

export function AgendaTasks(props:Props){
 const root=useRef<HTMLDivElement>(null),current=useRef(props);current.current=props;
 const gesture=useRef<Gesture|null>(null),frame=useRef<number|null>(null),landing=useRef<(()=>void)|null>(null),endedAt=useRef(0);
 const [active,setActive]=useState(false),[target,setTarget]=useState<Target|null>(null),[announcement,setAnnouncement]=useState('');

 function dropTarget(x:number,y:number,id:string):Target|null{
  const day=document.elementFromPoint(x,y)?.closest<HTMLElement>('[data-agenda-day]');
  if(!day||!root.current?.contains(day))return null;
  const rows=[...day.querySelectorAll<HTMLElement>('[data-agenda-task-id]')].filter(row=>row.dataset.agendaTaskId!==id);
  const before=rows.find(row=>{const rect=row.getBoundingClientRect();return y<rect.top+rect.height/2});
  const bounds=day.getBoundingClientRect(),last=rows.at(-1)?.getBoundingClientRect();
  // The compact card may show only the beginning of a day. Appending to its
  // visible rows inserts before the first hidden task, rather than after all of them.
  const all=current.current.groups.flatMap(group=>group.items).filter(item=>item.date===day.dataset.agendaDay&&item.task.id!==id);
  const lastId=rows.at(-1)?.dataset.agendaTaskId,lastIndex=all.findIndex(item=>item.task.id===lastId);
  const hiddenNext=lastIndex>=0?all[lastIndex+1]?.task.id:null;
  return {date:day.dataset.agendaDay!,beforeId:before?.dataset.agendaTaskId??hiddenNext??null,top:before?.getBoundingClientRect().top??last?.bottom??day.querySelector('.agenda-date')!.getBoundingClientRect().bottom+8,left:bounds.left,width:bounds.width};
 }
 function preview(){
  const d=gesture.current;if(!d?.active)return;
  if(current.current.readOnly){finish();return}
  if(d.y<100)window.scrollBy(0,-Math.min(12,(100-d.y)/4));
  else if(d.y>innerHeight-90)window.scrollBy(0,Math.min(12,(d.y-innerHeight+90)/4));
  d.ghost!.element.style.transform=`translate3d(${d.x-d.startX}px,${d.y-d.startY}px,0) scale(1.015)`;
  d.target=dropTarget(d.x,d.y,d.id);
  setTarget(previous=>previous?.date===d.target?.date&&previous?.beforeId===d.target?.beforeId?previous:d.target);
  if(d.line){d.line.style.visibility=d.target?'visible':'hidden';if(d.target)Object.assign(d.line.style,{left:d.target.left+'px',top:d.target.top+'px',width:d.target.width+'px'})}
  frame.current=requestAnimationFrame(preview);
 }
 function finish(commit=false){
  const d=gesture.current;if(!d)return;gesture.current=null;
  if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;
  if(d.handle.hasPointerCapture(d.pointerId))d.handle.releasePointerCapture(d.pointerId);
  d.line?.remove();d.row.classList.remove('agenda-drag-source');setActive(false);setTarget(null);
  if(!d.active)return;
  endedAt.current=Date.now();
  const destination=commit&&!current.current.readOnly?d.target:null;
  if(destination){
   flushSync(()=>current.current.onMove(d.id,destination.date,destination.beforeId));
   setAnnouncement('Дело перенесено на '+dateLabel(destination.date));
  }else setAnnouncement('Перемещение отменено');
  const ghost=d.ghost;if(!ghost)return;
  const row=[...root.current?.querySelectorAll<HTMLElement>('[data-agenda-task-id]')??[]].find(row=>row.dataset.agendaTaskId===d.id);
  const cleanup=()=>{ghost.element.remove();if(row)row.style.visibility=''};
  if(!row||reducedMotion()){cleanup();return}
  const rect=row.getBoundingClientRect(),from=ghost.element.style.transform;row.style.visibility='hidden';
  const animation=ghost.element.animate([{transform:from},{transform:`translate3d(${rect.left-ghost.from.left}px,${rect.top-ghost.from.top}px,0)`}],{duration:220,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'});
  let stopped=false;const done=()=>{if(stopped)return;stopped=true;cleanup();animation.cancel();if(destination&&row.isConnected)pulseTask(row)};
  animation.finished.then(done,done);landing.current=()=>{if(stopped)return;stopped=true;cleanup();animation.cancel()};
 }
 useEffect(()=>{
  const move=(event:PointerEvent)=>{
   const d=gesture.current;if(!d||d.pointerId!==event.pointerId)return;
   d.x=event.clientX;d.y=event.clientY;
   if(!d.active&&Math.hypot(d.x-d.startX,d.y-d.startY)>=6){
    if(current.current.readOnly)return;
    d.active=true;d.ghost=taskGhost(d.row);d.row.classList.add('agenda-drag-source');
    d.line=document.createElement('div');d.line.className='agenda-drop-line';d.line.setAttribute('aria-hidden','true');document.body.appendChild(d.line);
    setActive(true);frame.current=requestAnimationFrame(preview);
   }
   if(d.active)event.preventDefault();
  };
  const end=(event:PointerEvent)=>{const d=gesture.current;if(!d||d.pointerId!==event.pointerId)return;d.x=event.clientX;d.y=event.clientY;if(d.active)d.target=dropTarget(d.x,d.y,d.id);event.preventDefault();finish(true)};
  const cancel=()=>finish();const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&gesture.current){event.preventDefault();event.stopImmediatePropagation();finish()}};
  window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);window.addEventListener('keydown',key,true);
  return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);window.removeEventListener('keydown',key,true);if(frame.current!==null)cancelAnimationFrame(frame.current);const d=gesture.current;d?.line?.remove();d?.ghost?.element.remove();d?.row.classList.remove('agenda-drag-source');gesture.current=null;landing.current?.()};
 },[]);
 function start(event:ReactPointerEvent<HTMLButtonElement>,id:string){
  if(current.current.readOnly||event.button!==0||!event.isPrimary)return;
  event.preventDefault();event.stopPropagation();landing.current?.();
  const row=event.currentTarget.closest<HTMLElement>('[data-agenda-task-id]');if(!row)return;
  event.currentTarget.focus({preventScroll:true});event.currentTarget.setPointerCapture(event.pointerId);
  gesture.current={id,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,handle:event.currentTarget,row,active:false,target:null};
 }
 function keyboard(event:ReactKeyboardEvent,id:string){
  if(props.readOnly||(event.key!=='ArrowUp'&&event.key!=='ArrowDown'))return;
  event.preventDefault();event.stopPropagation();
  const days=agendaDays(props.groups,props.today,true),dayIndex=days.findIndex(day=>day.items.some(item=>item.task.id===id));if(dayIndex<0)return;
  const day=days[dayIndex],index=day.items.findIndex(item=>item.task.id===id);let date=day.key,beforeId:string|null=null;
  if(event.key==='ArrowUp'){
   if(index>0)beforeId=day.items[index-1].task.id;
   else if(dayIndex>0)date=days[dayIndex-1].key;else return;
  }else{
   if(index<day.items.length-1)beforeId=day.items[index+2]?.task.id??null;
   else if(dayIndex<days.length-1){date=days[dayIndex+1].key;beforeId=days[dayIndex+1].items[0]?.task.id??null}else return;
  }
  flushSync(()=>props.onMove(id,date,beforeId));setAnnouncement('Дело перенесено на '+dateLabel(date));
  [...root.current?.querySelectorAll<HTMLElement>('[data-agenda-task-id]')??[]].find(row=>row.dataset.agendaTaskId===id)?.querySelector<HTMLButtonElement>('.agenda-drag-handle')?.focus({preventScroll:true});
 }
 const days=agendaDays(props.groups,props.today,active);let shown=0;const limit=props.full?Infinity:10;
 return <div ref={root} className={'agenda-list'+(active?' agenda-sorting':'')} onClickCapture={event=>{if(Date.now()-endedAt.current<400){event.preventDefault();event.stopPropagation()}}}>
  {days.map(day=>{
   const items=day.items.slice(0,Math.max(0,limit-shown));shown+=items.length;if(!items.length&&day.items.length)return null;
   return <section className={'agenda-group'+(day.overdue?' overdue':'')+(target?.date===day.key?' agenda-drop-day':'')} data-agenda-day={day.key} key={day.key}>
    <div className="agenda-date"><span>{day.label}</span>{day.hint&&<small>{day.hint}</small>}</div>
    {!items.length&&<div className="agenda-empty-drop">Перенести на этот день</div>}
    <div className="tasks">{items.map(({note,task,time,source})=><div className="task-row agenda-row" key={task.id} data-agenda-task-id={task.id}>
     {!props.readOnly&&<button type="button" className="agenda-drag-handle drag-handle" aria-label={'Переместить дело '+(task.text||'Без названия')} title="Перетащить дело. С клавиатуры: ↑ и ↓" onPointerDown={event=>start(event,task.id)} onKeyDown={event=>keyboard(event,task.id)} onClick={event=>event.stopPropagation()}><GripVertical size={18}/></button>}
     <TaskCheckbox done={task.done} label={task.text||'Без названия'} disabled={props.readOnly} onToggleDone={()=>props.onToggle(note,task)}/>
     {props.full?<button type="button" className="agenda-task" onClick={()=>props.onOpen(note)}><span className="task-label"><TaskText text={task.text||'Без названия'}/></span><small>{time&&<b>{time} · </b>}{source}</small></button>:<span className="agenda-task"><span className="task-label"><TaskText text={task.text||'Без названия'}/></span><small>{time&&<b>{time} · </b>}{source}</small></span>}
    </div>)}</div>
   </section>;
  })}
  <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
 </div>;
}
