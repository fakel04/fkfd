'use client';
import {useEffect,useRef} from 'react';
import {flushSync} from 'react-dom';
import {captureTaskLayout,animateTaskLayout,taskGhost,reducedMotion,pulseTask} from './task-motion';

export function useTaskTransferMotion(){
 const effects=useRef(new Set<()=>void>());
 useEffect(()=>()=>{effects.current.forEach(cleanup=>cleanup())},[]);
 return function transfer(noteId:string,taskId:string,toId:string,title:string,fromEditor:boolean,commit:()=>void){
  const host=fromEditor?document.querySelector('.editor'):Array.from(document.querySelectorAll<HTMLElement>('[data-note-id]')).find(note=>note.dataset.noteId===noteId);
  const row=Array.from(host?.querySelectorAll<HTMLElement>('[data-editor-task-id],[data-task-id]')??[]).find(task=>(task.dataset.editorTaskId||task.dataset.taskId)===taskId);
  if(!row||reducedMotion()||typeof row.animate!=='function'){commit();return;}
  const before=captureTaskLayout(document.querySelector('.app-shell')??document);
  const ghost=taskGhost(row);
  try{flushSync(commit)}catch(error){ghost.element.remove();throw error;}
  const cleanupLayout=animateTaskLayout(before);
  const viewport=window.visualViewport;
  const left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;
  const card=fromEditor?undefined:Array.from(document.querySelectorAll<HTMLElement>('[data-note-id]')).find(note=>note.dataset.noteId===toId);
  const header=card?.querySelector<HTMLElement>('.note-title');const rect=header?.getBoundingClientRect();
  const visible=!!rect&&rect.top>=top+70&&rect.bottom<=top+height-80&&rect.right>left&&rect.left<left+width;
  let chip:HTMLElement|undefined;
  let target=visible?header:undefined;
  if(!target){
   chip=document.createElement('div');chip.className='task-transfer-destination';chip.setAttribute('aria-hidden','true');
   const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.8');
   const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M20 16.6A4.5 4.5 0 0 0 18 8a6 6 0 1 0-12 8.6Z');icon.appendChild(path);
   const label=document.createElement('span');label.textContent=`В «${title}»`;chip.appendChild(icon);chip.appendChild(label);
   Object.assign(chip.style,{right:Math.max(16,innerWidth-left-width+16)+'px',top:(top+height-90)+'px',maxWidth:Math.max(140,width-32)+'px'});
   document.body.appendChild(chip);target=chip;
  }
  const destination=target.getBoundingClientRect(),from=ghost.from;
  const scale=Math.min(.55,Math.max(.18,destination.width/from.width));
  const dx=destination.left+destination.width/2-from.left-from.width*scale/2;
  const dy=destination.top+destination.height/2-from.top-from.height*scale/2;
  const animation=ghost.element.animate([
   {transform:'translate(0,0) scale(1)',opacity:1,offset:0},
   {transform:'translate(0,-6px) scale(1.015)',opacity:1,offset:.15},
   {transform:`translate(${dx}px,${dy}px) scale(${scale})`,opacity:.85,offset:.88},
   {transform:`translate(${dx}px,${dy}px) scale(${scale*.88})`,opacity:0,offset:1}
  ],{duration:620,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'});
  let pulse:(()=>void)|undefined;
  const pulseTimer=setTimeout(()=>{if(target?.isConnected)pulse=pulseTask(target)},450);
  let done=false;const cleanup=()=>{if(done)return;done=true;clearTimeout(pulseTimer);ghost.element.remove();chip?.remove();animation.cancel();cleanupLayout();pulse?.();};
  const finishTimer=setTimeout(()=>dispose(),1000);
  const dispose=()=>{clearTimeout(finishTimer);cleanup();effects.current.delete(dispose)};
  effects.current.add(dispose);
  animation.finished.then(()=>{ghost.element.remove()},dispose);
 };
}
