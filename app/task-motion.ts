import {taskDropIndex,taskSortPositions,type SortBox} from './task-sort.ts';

const EASE='cubic-bezier(.22,1,.36,1)';
export const reducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wrap=(row:HTMLElement)=>row.closest<HTMLElement>('.swipe-task')||row;
const rowId=(row:HTMLElement)=>row.dataset.editorTaskId||row.dataset.taskId||'';
const running=new WeakMap<Element,Animation>();
export type Layout=Map<HTMLElement,DOMRect>;

export function captureTaskLayout(host:Element|Document):Layout{
 return new Map([...host.querySelectorAll<HTMLElement>('.swipe-task,.note')].map(element=>[element,element.getBoundingClientRect()]));
}
export function animateTaskLayout(before:Layout,skip?:HTMLElement){
 if(reducedMotion())return()=>{};
 for(const element of before.keys())running.get(element)?.cancel();
 const after=new Map([...before.keys()].filter(element=>element.isConnected).map(element=>[element,element.getBoundingClientRect()]));
 const animations:Animation[]=[];
 for(const [element,rect] of before){
  const now=after.get(element);if(!now||element===skip)continue;
  let dx=rect.left-now.left,dy=rect.top-now.top;
  // Avoid doubling a translation when both a card and a task inside it move.
  for(let parent=element.parentElement;parent;parent=parent.parentElement){
   const oldParent=before.get(parent),newParent=after.get(parent);
   if(oldParent&&newParent){dx-=oldParent.left-newParent.left;dy-=oldParent.top-newParent.top;break;}
  }
  if(Math.abs(dx)<1&&Math.abs(dy)<1)continue;
  const animation=element.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],{duration:300,easing:EASE});
  running.set(element,animation);animations.push(animation);
 }
 return()=>animations.forEach(animation=>animation.cancel());
}

/** Inert visual copy; values in textareas must be copied explicitly. */
export function taskGhost(row:HTMLElement){
 const source=wrap(row),rect=source.getBoundingClientRect();
 const ghost=document.createElement('div');ghost.className='task-motion-ghost keep-layout';ghost.inert=true;ghost.setAttribute('aria-hidden','true');
 const editor=!!row.closest('.editor');const skin=document.createElement('div');
 skin.className=editor?'editor editor-task-list sortable-tasks task-motion-skin':`notes-grid ${row.closest('.notes-grid.list')?'list':'grid'} task-motion-skin`;
 const surface=row.closest<HTMLElement>('.editor,.note');
 if(surface)ghost.style.setProperty('--task-surface',getComputedStyle(surface).backgroundColor);
 let host=skin;
 if(!editor){host=document.createElement('div');host.className='note';skin.appendChild(host);}
 const copy=source.cloneNode(true) as HTMLElement;
 const fields=source.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea');
 copy.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea').forEach((field,i)=>field.value=fields[i]?.value??field.value);
 for(const element of [copy,...copy.querySelectorAll<HTMLElement>('*')]){
  for(const name of element.getAttributeNames())if(name==='id'||name.startsWith('data-')||name==='autofocus')element.removeAttribute(name);
 }
 copy.querySelectorAll('.swipe-actions,.task-menu-trigger').forEach(element=>element.remove());
 copy.classList.remove('swipe-open');copy.style.cssText='';
 const content=copy.querySelector<HTMLElement>('.swipe-content');if(content){content.style.transform='none';content.classList.remove('swiping');}
 host.appendChild(copy);ghost.appendChild(skin);
 Object.assign(ghost.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
 document.body.appendChild(ghost);
 return {element:ghost,from:rect};
}

export function pulseTask(element:HTMLElement){
 if(reducedMotion())return()=>{};
 const animation=element.animate([{boxShadow:'0 0 0 0 #63895a00'},{boxShadow:'0 0 0 3px #63895a60',offset:.35},{boxShadow:'0 0 0 0 #63895a00'}],{duration:480,easing:'ease-out'});
 return()=>animation.cancel();
}

/** Pointer preview only. Task data is committed once on drop, never on hover. */
export class TaskLift{
 root:HTMLElement;row:HTMLElement;id:string;pointerX:number;pointerY:number;index:number;
 ghost:ReturnType<typeof taskGhost>;slot:HTMLElement;rows:{element:HTMLElement;box:SortBox}[];
 rootTop:number;gap:number;source:HTMLElement;sourceVisibility:string;stopped=false;
 constructor(root:HTMLElement,row:HTMLElement,x:number,y:number,pinned:(id:string)=>boolean){
  this.root=root;this.row=row;this.id=rowId(row);this.pointerX=x;this.pointerY=y;
  this.source=wrap(row);this.sourceVisibility=this.source.style.visibility;
  this.rows=[...root.querySelectorAll<HTMLElement>('[data-editor-task-id],[data-task-id]')].map(item=>{
   const element=wrap(item),rect=element.getBoundingClientRect();
   return {element,box:{id:rowId(item),top:rect.top,height:rect.height,pinned:pinned(rowId(item))}};
  });
  this.index=this.rows.findIndex(item=>item.box.id===this.id);
  this.rootTop=root.getBoundingClientRect().top;
  this.gap=this.rows.length>1?Math.max(0,this.rows[1].box.top-this.rows[0].box.top-this.rows[0].box.height):0;
  this.ghost=taskGhost(row);this.ghost.element.classList.add('task-lift-ghost');
  this.slot=document.createElement('div');this.slot.className='task-drop-slot';this.slot.setAttribute('aria-hidden','true');document.body.appendChild(this.slot);
  this.source.style.visibility='hidden';root.classList.add('task-sorting');
  this.move(x,y);
 }
 move(x:number,y:number){
  if(this.stopped)return null;
  const bounds=this.root.getBoundingClientRect(),shift=bounds.top-this.rootTop;
  const panel=this.root.closest('.modal-panel')?.getBoundingClientRect();
  const inside=x>=bounds.left-24&&x<=bounds.right+24&&y>=bounds.top-24&&y<=bounds.bottom+24&&(!panel||y>=panel.top&&y<=panel.bottom);
  const center=y-this.pointerY+this.ghost.from.top+Math.min(this.ghost.from.height/2,28)-shift;
  const boxes=this.rows.map(item=>item.box);
  this.index=inside?taskDropIndex(boxes,this.id,center):boxes.findIndex(row=>row.id===this.id);
  const targets=taskSortPositions(boxes,this.id,this.index,this.gap);
  for(const {element,box} of this.rows){
   element.classList.add('task-sort-shift');
   element.style.transform=`translate3d(0,${(targets.get(box.id)??box.top)-box.top}px,0)`;
  }
  const top=(targets.get(this.id)??this.ghost.from.top)+shift;
  Object.assign(this.slot.style,{left:bounds.left+'px',top:top+'px',width:this.ghost.from.width+'px',height:this.ghost.from.height+'px',visibility:inside?'visible':'hidden'});
  this.ghost.element.style.transform=`translate3d(${x-this.pointerX}px,${y-this.pointerY}px,0) scale(1.015)`;
  return inside?this.index:null;
 }
 finish(commit?:()=>void,findTarget?:()=>HTMLElement|undefined){
  if(this.stopped)return()=>{};this.stopped=true;
  const before=captureTaskLayout(this.root),from=this.ghost.element.getBoundingClientRect();
  for(const {element} of this.rows){element.classList.remove('task-sort-shift');element.style.transform='';}
  this.slot.remove();this.root.classList.remove('task-sorting');
  try{commit?.()}catch(error){this.source.style.visibility=this.sourceVisibility;this.ghost.element.remove();throw error;}
  const target=[...this.root.querySelectorAll<HTMLElement>('[data-editor-task-id],[data-task-id]')].find(item=>rowId(item)===this.id);
  const destination=findTarget?.()||(target?wrap(target):this.source);
  const rect=destination.isConnected?destination.getBoundingClientRect():from;
  const cleanupLayout=animateTaskLayout(before,destination);
  const previous=destination===this.source?this.sourceVisibility:destination.style.visibility;destination.style.visibility='hidden';
  const ghost=this.ghost.element;ghost.style.transform='none';Object.assign(ghost.style,{left:from.left+'px',top:from.top+'px'});
  const cleanup=()=>{ghost.remove();cleanupLayout();destination.style.visibility=previous;this.source.style.visibility=this.sourceVisibility;};
  if(reducedMotion()){cleanup();return cleanup;}
  const animation=ghost.animate([{transform:'scale(1.015)',opacity:1},{transform:`translate(${rect.left-from.left}px,${rect.top-from.top}px) scale(1)`,opacity:destination.isConnected?1:0}],{duration:300,easing:EASE,fill:'forwards'});
  let ended=false;const done=()=>{if(ended)return;ended=true;cleanup();animation.cancel();if(commit&&destination.isConnected)pulseTask(destination)};
  animation.finished.then(done,done);
  return()=>{if(ended)return;ended=true;cleanup();animation.cancel();};
 }
 dispose(){this.stopped=true;this.slot.remove();this.ghost.element.remove();this.root.classList.remove('task-sorting');for(const {element} of this.rows){element.classList.remove('task-sort-shift');element.style.transform='';}this.source.style.visibility=this.sourceVisibility;}
}
