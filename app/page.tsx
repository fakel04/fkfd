'use client';
import {canWrite,canAdmin,roleNames} from './access-model';
import {signInHref,signOutHref} from './auth-links';
import {useOfflineBoard} from './use-offline-board';
import {syncNotice} from './sync-status';
import {useSafeAppUpdate} from './use-safe-app-update';
import {useEditorHistory} from './use-editor-history';
import {EditorHistoryControls} from './editor-history-controls';
import {useTaskTransferMotion} from './use-task-transfer-motion';
import {TaskLift,captureTaskLayout,animateTaskLayout} from './task-motion';
import {reorderTasks} from './task-sort';
import {flushSync} from 'react-dom';
import {TriangleAlert} from 'lucide-react';
import {noteEdit,equal} from './board-merge';
import {SyncConflicts} from './sync-conflicts';
import {ShieldCheck,Eye,LogOut} from 'lucide-react';
import { MasonryNotes } from './masonry-notes';
import { EditorTaskList } from './editor-task-list';
import { TagPicker } from './tag-picker';
import { DuePicker } from './due-picker';
import { TaskDescriptionEditor } from './task-description-editor';
import { TaskMaterials } from './task-materials';
import { TaskAiLinksEditor } from './task-ai-links-editor';
import { TaskParentPicker } from './task-parent-picker';
import { createParentResolver, canChooseParent } from './task-relations';
import { TaskCheckbox } from './task-checkbox';
import { TaskDetails, TaskText } from './task-details';
import { buildAgenda, agendaUrgentCount, TODAY_VIEW } from './today-agenda';
import { localDate } from './task-due';
import { expandTaskLines, prepareTaskList } from './task-list-edit';
import { boardLabels, preserveLabelCatalog, hasLabel, noteHasLabel, taskLabels, taskDueDate, taskDescription, FOCUS_NOTE_ID, pinnedFirst, moveTaskToCloud, ensureFocusBoard, isFocusNote, moveToFocus, returnFromFocus, sourceTitle, type Board, type Note, type Task, type TaskParent } from './board-model';
import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react';
import { AlignLeft, CornerDownRight, CalendarDays, Paperclip, ArrowDownUp, Rows2, ArrowLeft, Cloud, Search, Plus, LayoutGrid, List, Pin, Archive, Trash2, X, Check, GripVertical, ArrowUp, ArrowDown, Palette, Menu, Tag, CheckCheck, Download, RotateCcw, StickyNote, CircleHelp, CloudCheck, ArrowUpRight } from 'lucide-react';

type TaskTarget={noteId:string;taskId:string;fromEditor:boolean};
type Drag={kind:'note'|'task';noteId:string;taskId?:string;x:number;y:number;active:boolean;label:string;pointerId:number;lift?:TaskLift;card?:HTMLElement;color?:string};
const colors=['white','lavender','peach','sage','blue','yellow'];
const colorNames=['Бумага','Лаванда','Персик','Шалфей','Небо','Ваниль'];
const uid=()=>crypto.randomUUID();
const blank=(category='') : Note=>({id:uid(),title:'',text:'',tasks:[],color:'white',category,pinned:false,archived:false,deleted:false,created:new Date().toISOString()});
function initial():Board{
 const make=(id:string,title:string,color:string,text:string,tasks:string[],pinned=false,category='')=>({id,title,color,text,tasks:tasks.map((text,i)=>({id:id+'-'+i,text,done:false})),pinned,category,archived:false,deleted:false,example:true,created:'2026-11-12T00:00:00Z'});
 return ensureFocusBoard({categories:['Картон','Косметика','Личное','Идеи'],notes:[
 make('welcome','Мысли — в облака','lavender','Большие планы, маленькие дела и внезапные идеи. Здесь всему найдётся место.',['Создать своё первое облако','Расставить карточки по-своему'],true),
 make('today','На сегодня','yellow','Один небольшой список, чтобы освободить голову.',['Самое важное дело','То, что давно откладывал','Немного времени для себя'],true),
 make('ideas','А что, если…','peach','Оставить здесь мысль, пока она не улетела?\n\nНе каждой идее сразу нужен дедлайн.',[],false,'Идеи'),
 make('work','Всё рядом','white','У каждой темы — своё облако. Задачи можно переносить между ними за шесть точек слева.',['Рабочие вопросы','Личные планы','Что-нибудь хорошее']),
 make('notes','Просто заметка','sage','Можно писать свободно. Без галочек, сроков и обязательных полей.\n\nКак на листке бумаги — только он не потеряется.',[],false,'Личное'),
 make('learn','Порядок — ваш','blue','Карточки можно перетаскивать, раскрашивать и закреплять. А когда дело сделано — отправлять в архив.',[],false),
 ]});
}
export default function Home(){
 const offline=useOfflineBoard(initial);const {controller,board,session,ready,status,error}=offline;
 const notice=syncNotice(offline);
 const transferMotion=useTaskTransferMotion();
 const conflict=offline.conflicts.length>0;const demo=false;const latest=useRef(board);latest.current=board;
 const writeAllowed=useRef(false);writeAllowed.current=ready&&!conflict&&!offline.storageFailed&&canWrite(session?.role??null);
 const editorOriginal=useRef<Note|null>(null);const editorStart=useRef<Note|null>(null);const [confirmCancel,setConfirmCancel]=useState(false);const draftId=useRef('');const draftHydrated=useRef(false);
 const [organizing,setOrganizing]=useState(false);
 const [view,setView]=useState('all'); const [query,setQuery]=useState(''); const [layout,setLayout]=useState<'grid'|'list'>('grid'); const [sidebar,setSidebar]=useState(false);
 const editorHistory=useEditorHistory();const {value:editor,set:setEditor,reset:resetEditor}=editorHistory;const editorElement=useRef<HTMLDivElement>(null);
 const [isNew,setIsNew]=useState(false); const [quick,setQuick]=useState(''); const [categoryModal,setCategoryModal]=useState(false); const [newCategory,setNewCategory]=useState('');
 useEffect(()=>{try{const saved=localStorage.getItem('oblaka-board-layout');if(saved==='grid'||saved==='list')setLayout(saved)}catch{}},[]);
 function resetEditorTo(note:Note,start:Note|null=note){editorStart.current=structuredClone(start);setConfirmCancel(false);resetEditor(note)}
 // iPhone paints the status-bar area (and Safari its bars) from theme-color and the page
 // background. While a cloud is open, use the cloud's colour there so its background
 // reaches the top of the screen; restore the board colours when it closes.
 const editorColor=editor?.color;
 useEffect(()=>{
  if(!editorColor)return;
  const meta=document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const previousMeta=meta?.content,previousBackground=document.documentElement.style.backgroundColor;
  const frame=requestAnimationFrame(()=>{
   const color=editorElement.current&&getComputedStyle(editorElement.current).backgroundColor;
   if(!color||color==='rgba(0, 0, 0, 0)')return;
   if(meta)meta.content=color;
   document.documentElement.style.backgroundColor=color;
  });
  return()=>{cancelAnimationFrame(frame);if(meta&&previousMeta!==undefined)meta.content=previousMeta;document.documentElement.style.backgroundColor=previousBackground};
 },[editorColor]);
 function chooseLayout(value:'grid'|'list'){setLayout(value);try{localStorage.setItem('oblaka-board-layout',value)}catch{}}
 const [toast,setToast]=useState(''); const [palette,setPalette]=useState<string|null>(null);
 const [dragVisual,setDragVisual]=useState<{x:number;y:number;label:string;color?:string}|null>(null); const drag=useRef<Drag|null>(null);const dragEndedAt=useRef(0);const dragLanding=useRef<(()=>void)|null>(null);
 const [taskAction,setTaskAction]=useState<{noteId:string;taskId:string;fromEditor:boolean;mode:'more'|'cloud'}|null>(null);
 const [cloudQuery,setCloudQuery]=useState('');
 const [tagView,setTagView]=useState<string|null>(null);
 const [tagPicker,setTagPicker]=useState<TaskTarget|null>(null);
 const [duePicker,setDuePicker]=useState<TaskTarget|null>(null);
 const [descriptionEditor,setDescriptionEditor]=useState<TaskTarget|null>(null);
 const [materialsTarget,setMaterialsTarget]=useState<TaskTarget|null>(null);
 const [parentPicker,setParentPicker]=useState<TaskTarget|null>(null);
 const [help,setHelp]=useState(false); const [removeExamples,setRemoveExamples]=useState(false);
 useSafeAppUpdate(offline.updateVersion,()=>ready&&!editor&&!quick&&!newCategory&&!drag.current&&!organizing&&!sidebar&&!toast&&!palette&&!offline.drafts.length&&!offline.localSaving&&!offline.storageFailed&&!conflict&&!materialsTarget&&!descriptionEditor&&!taskAction);
 const notify=(s:string)=>{setToast(s);};
 useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),3500);return()=>clearTimeout(t)}},[toast]);
 function update(next:Board|((b:Board)=>Board)){
  if(!writeAllowed.current)return;
  const value=preserveLabelCatalog(typeof next==='function'?next(latest.current):next,latest.current);
  if(controller.update(value))latest.current=controller.state.board;
 }
 const patch=(id:string,p:Partial<Note>)=>update(b=>({...b,notes:b.notes.map(n=>n.id===id?{...n,...p}:n)}));
 const save=()=>controller.sync();const load=()=>controller.retry();
 useEffect(()=>{
  if(!ready)return;
  if(!draftHydrated.current){draftHydrated.current=true;const saved=[...offline.drafts].sort((a,b)=>b.updatedAt-a.updatedAt)[0];
   if(saved){draftId.current=uid();void controller.adoptDraft(saved,draftId.current).catch(()=>{});editorOriginal.current=saved.original;resetEditorTo(saved.note,saved.original);setIsNew(!saved.original);notify('Восстановлен черновик с этого устройства')}return;
  }
  if(!draftId.current)return;
  void controller.draft(editor?{id:draftId.current,original:editorOriginal.current,note:editor,updatedAt:Date.now()}:null,draftId.current).catch(()=>{});
 },[editor,ready,controller]);
 function commitEditor(note:Note){
  const operation=noteEdit(latest.current,editorOriginal.current,note);
  if(controller.enqueue(operation)){latest.current=controller.state.board;editorOriginal.current=structuredClone(latest.current.notes.find(n=>n.id===note.id)||note);return true}return false;
 }
 useEffect(()=>{
  const clearTargets=()=>document.querySelectorAll('.drop-target').forEach(el=>el.classList.remove('drop-target'));
  const move=(e:PointerEvent)=>{
   const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;
   if(!d.active&&Math.hypot(e.clientX-d.x,e.clientY-d.y)>6){
    d.active=true;
    if(d.kind==='note'){d.card=[...document.querySelectorAll<HTMLElement>('[data-note-id]')].find(note=>note.dataset.noteId===d.noteId);d.card?.classList.add('drag-source');}
    if(d.kind==='task'){
     const card=[...document.querySelectorAll<HTMLElement>('[data-note-id]')].find(note=>note.dataset.noteId===d.noteId);
     const row=[...card?.querySelectorAll<HTMLElement>('[data-task-id]')??[]].find(task=>task.dataset.taskId===d.taskId);
     const list=row?.closest<HTMLElement>('.tasks');
     if(row&&list)d.lift=new TaskLift(list,row,d.x,d.y,id=>!!latest.current.notes.find(note=>note.id===d.noteId)?.tasks.find(task=>task.id===id)?.pinned);
    }
   }
   if(!d.active)return;e.preventDefault();clearTargets();
   if(d.lift)d.lift.move(e.clientX,e.clientY);else setDragVisual({x:e.clientX,y:e.clientY,label:d.label,color:d.color});
   const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-note-id]');
   if(target&&(d.kind==='note'||target.dataset.noteId!==d.noteId))target.classList.add('drop-target');
   if(e.clientY<100)window.scrollBy(0,-12);if(e.clientY>innerHeight-70)window.scrollBy(0,12);
  };
  const end=(e:PointerEvent)=>{
   const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;drag.current=null;setDragVisual(null);clearTargets();d.card?.classList.remove('drag-source');
   if(!d.active)return;
   dragEndedAt.current=Date.now();
   const el=document.elementFromPoint(e.clientX,e.clientY);
   const targetNote=el?.closest<HTMLElement>('[data-note-id]')?.dataset.noteId;
   const targetTask=el?.closest<HTMLElement>('[data-task-id]')?.dataset.taskId;
   const index=d.lift?.move(e.clientX,e.clientY);
   if(!targetNote||!writeAllowed.current||(d.kind==='task'&&targetNote===d.noteId&&index==null)){dragLanding.current=d.lift?.finish()??null;return;}
   const commit=()=>flushSync(()=>update(b=>{
    if(d.kind==='task'&&targetNote===d.noteId&&index!=null){
     return {...b,notes:b.notes.map(note=>note.id===d.noteId?{...note,tasks:[...reorderTasks(pinnedFirst(note.tasks.filter(task=>!task.done)),d.taskId!,index),...note.tasks.filter(task=>task.done)]}:note)};
    }
    const base=d.kind==='task'&&targetNote===FOCUS_NOTE_ID&&d.noteId!==FOCUS_NOTE_ID?moveToFocus(b,d.noteId,d.taskId!):b;
    const notes=structuredClone(base.notes);const source=notes.find(n=>n.id===(base!==b?FOCUS_NOTE_ID:d.noteId));const target=notes.find(n=>n.id===targetNote);if(!source||!target)return b;
    if(d.kind==='note'){if(source.id===target.id)return b;const down=notes.indexOf(source)<notes.indexOf(target);notes.splice(notes.indexOf(source),1);source.pinned=isFocusNote(source)||target.pinned;notes.splice(notes.indexOf(target)+(down?1:0),0,source);}
    else{if(d.taskId===targetTask)return b;const index=source.tasks.findIndex(t=>t.id===d.taskId);if(index<0)return b;const [task]=source.tasks.splice(index,1);if(isFocusNote(source)&&!isFocusNote(target)){delete task.focused;delete task.origin;}const ti=target.tasks.findIndex(t=>t.id===targetTask);const rect=el?.closest<HTMLElement>('[data-task-id]')?.getBoundingClientRect();const after=rect&&e.clientY>=rect.top+rect.height/2;target.tasks.splice(ti<0?target.tasks.length:ti+(after?1:0),0,task);}
    return {...b,notes};
   }));
   if(d.lift)dragLanding.current=d.lift.finish(commit,()=>{
    const card=[...document.querySelectorAll<HTMLElement>('[data-note-id]')].find(note=>note.dataset.noteId===targetNote);
    const row=[...card?.querySelectorAll<HTMLElement>('[data-task-id]')??[]].find(task=>task.dataset.taskId===d.taskId);
    return row?.closest<HTMLElement>('.swipe-task')??card?.querySelector<HTMLElement>('.note-title')??undefined;
   });
   else{const before=captureTaskLayout(document.querySelector('.main-shell')!);commit();dragLanding.current=animateTaskLayout(before,undefined,d.kind==='note'?420:300);}
  };
  const cancel=()=>{const d=drag.current;d?.card?.classList.remove('drag-source');drag.current=null;dragLanding.current=d?.lift?.finish()??null;setDragVisual(null);clearTargets()};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&drag.current){e.preventDefault();cancel();}};
  window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);window.addEventListener('keydown',key);
  return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);window.removeEventListener('keydown',key);drag.current?.lift?.dispose();dragLanding.current?.();};
 },[]);
 function startDrag(e:React.PointerEvent,kind:'note'|'task',note:Note,task?:Task){
  if(e.button!==0||!e.isPrimary||!writeAllowed.current)return;e.preventDefault();e.stopPropagation();dragLanding.current?.();dragLanding.current=null;
  document.dispatchEvent(new CustomEvent('task-swipe-open',{detail:null}));
  drag.current={kind,noteId:note.id,taskId:task?.id,x:e.clientX,y:e.clientY,pointerId:e.pointerId,active:false,label:task?.text||note.title||'Облако',color:kind==='note'?note.color:undefined};
 }
 function keyboardMove(e:React.KeyboardEvent,n:Note,t?:Task){if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return;e.preventDefault();const dir=e.key==='ArrowUp'?-1:1;
  const before=captureTaskLayout(document.querySelector('.main-shell')!);
  flushSync(()=>update(b=>{const notes=structuredClone(b.notes);if(t){const target=notes.find(x=>x.id===n.id)!;const active=pinnedFirst(target.tasks.filter(task=>!task.done));const i=active.findIndex(x=>x.id===t.id);const j=i+dir;if(j>=0&&j<active.length)target.tasks=[...reorderTasks(active,t.id,j),...target.tasks.filter(task=>task.done)];}else{const i=notes.findIndex(x=>x.id===n.id);const j=i+dir;if(j>=0&&j<notes.length){notes[i].pinned=isFocusNote(notes[i])||notes[j].pinned;[notes[i],notes[j]]=[notes[j],notes[i]];}}return {...b,notes}}));
  dragLanding.current?.();dragLanding.current=animateTaskLayout(before);
 }

 function openNew(list=false){if(!writeAllowed.current)return;const n=blank(board.categories.includes(view)?view:'');n.title=quick;if(list)n.tasks=[{id:uid(),text:'',done:false}];setQuick('');editorOriginal.current=null;draftId.current=uid();setIsNew(true);resetEditorTo(n)}
 function openEditor(note:Note){editorOriginal.current=structuredClone(note);draftId.current=uid();const draft=structuredClone(note);if(writeAllowed.current)draft.tasks=expandTaskLines(draft.tasks);resetEditorTo(draft);setIsNew(false)}
 function stepEditorHistory(direction:'undo'|'redo'){
  if(!writeAllowed.current||!editor||(direction==='undo'?!editorHistory.canUndo:!editorHistory.canRedo))return;
  const root=editorElement.current,active=document.activeElement;
  const input=root?.contains(active)&&(active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement)?active:null;
  const taskId=input?.closest<HTMLElement>('[data-editor-task-id]')?.dataset.editorTaskId;
  const index=editor.tasks.findIndex(task=>task.id===taskId);
  const start=input?.selectionStart??0,end=input?.selectionEnd??0,atEnd=!!input&&end===input.value.length;
  // Synchronous focus restoration keeps the iPhone keyboard open, even when
  // undoing Enter removes the textarea that currently owns the caret.
  flushSync(()=>direction==='undo'?editorHistory.undo():editorHistory.redo());
  if(!input||!root)return;
  let target:HTMLInputElement|HTMLTextAreaElement|null=input.isConnected?input:null;
  if(!target){
   const rows=[...root.querySelectorAll<HTMLElement>('[data-editor-task-id]')];
   target=(rows.find(row=>row.dataset.editorTaskId===taskId)||rows[Math.max(0,Math.min(index-1,rows.length-1))])?.querySelector<HTMLTextAreaElement>('textarea')??root.querySelector<HTMLTextAreaElement>('.editor-text');
  }
  if(target){target.focus({preventScroll:true});const length=target.value.length;target.setSelectionRange(atEnd?length:Math.min(start,length),atEnd?length:Math.min(end,length))}
 }
 function saveEditor(){if(conflict||offline.storageFailed){notify('Сначала сохраните копию и разрешите проблему синхронизации.');return;}if(!writeAllowed.current){setEditor(null);return;}saveEditorWith({})}
 function saveEditorWith(changes:Partial<Note>){if(!editor)return;const n={...editor,...changes,title:editor.title.trim(),tasks:prepareTaskList(editor.tasks)};if(!n.title&&!n.text.trim()&&!n.tasks.length){setEditor(null);return;}if(commitEditor(n)){void save();setEditor(null)}}
 // Closing via Done, Escape or the backdrop saves; only Cancel discards, so ask first.
 function editorDirty(){
  if(!editor)return false;
  if(isNew)return !!(editor.title.trim()||editor.text.trim()||editor.tasks.some(t=>t.text.trim()));
  return !equal(editor,editorStart.current);
 }
 function discardEditor(){setConfirmCancel(false);setEditor(null)}
 function cancelEditor(){if(editorDirty())setConfirmCancel(true);else discardEditor()}
 function addTask(n:Note,text:string){if(text.trim())patch(n.id,{tasks:[...n.tasks,{id:uid(),text:text.trim(),done:false}]})}
 function toggleTaskFocus(noteId:string,taskId:string,fromEditor=false){
  if(!ready||conflict||!writeAllowed.current)return;
  let base=latest.current;
  if(fromEditor&&editor){
   const draft={...editor,title:editor.title.trim(),tasks:prepareTaskList(editor.tasks)};
   if(!commitEditor(draft))return;base=latest.current;
  }
  const returning=noteId===FOCUS_NOTE_ID;
  const task=base.notes.find(n=>n.id===noteId)?.tasks.find(t=>t.id===taskId);
  if(!task||(!returning&&!task.text.trim()))return;
  const destination=returning?sourceTitle(base,task):'Задачи';
  const next=returning?returnFromFocus(base,taskId):moveToFocus(base,noteId,taskId);
  const destinationId=next.notes.find(note=>note.tasks.some(item=>item.id===taskId))?.id;
  if(!destinationId||destinationId===noteId)return;
  transferMotion(noteId,taskId,destinationId,destination,fromEditor,()=>{
  update(next);
  // A cross-cloud transfer is committed immediately. Start a new draft history
  // so undo cannot resurrect the transferred task in two clouds.
  if(fromEditor){editorOriginal.current=structuredClone(next.notes.find(n=>n.id===noteId)!);resetEditorTo(editorOriginal.current!);setIsNew(false)}
  });
  notify(returning?`Возвращено в «${destination}»`:'Перенесено в «Задачи»');
 }
 function openTaskActions(noteId:string,taskId:string,fromEditor:boolean,mode:'more'|'cloud'){
  if(!writeAllowed.current||conflict)return;
  const note=fromEditor&&editor?.id===noteId?editor:latest.current.notes.find(note=>note.id===noteId);
  const task=note?.tasks.find(task=>task.id===taskId);
  if(mode==='cloud'&&noteId===FOCUS_NOTE_ID&&task?.origin){
   toggleTaskFocus(noteId,taskId,fromEditor);
   setTaskAction(null);
   return;
  }
  setCloudQuery('');setTaskAction({noteId,taskId,fromEditor,mode});
 }
 function changeActionTask(change:Partial<Task>){
  if(!taskAction||!writeAllowed.current||conflict)return;
  const {noteId,taskId,fromEditor}=taskAction;
  if(fromEditor)setEditor(current=>current?{...current,tasks:current.tasks.map(t=>t.id===taskId?{...t,...change}:t)}:null);
  else update(b=>({...b,notes:b.notes.map(n=>n.id===noteId?{...n,tasks:n.tasks.map(t=>t.id===taskId?{...t,...change}:t)}:n)}));
  setTaskAction(null);
 }
 function moveActionTask(toId:string){
  if(!taskAction||!writeAllowed.current||conflict)return;
  if(taskAction.fromEditor&&editor&&!commitEditor(editor))return;
  const base=latest.current;const {noteId,taskId,fromEditor}=taskAction;
  const task=base.notes.find(n=>n.id===noteId)?.tasks.find(t=>t.id===taskId);
  const next=toId==='__origin__'?returnFromFocus(base,taskId):moveTaskToCloud(base,noteId,taskId,toId);
  if(next===base){notify('Не удалось перенести задачу. Возможно, облако заполнено.');return;}
  const destination=next.notes.find(note=>note.tasks.some(item=>item.id===taskId));
  if(!destination)return;
  transferMotion(noteId,taskId,destination.id,destination.title||'Без названия',fromEditor,()=>{
  update(next);void save();
  if(fromEditor){editorOriginal.current=structuredClone(next.notes.find(n=>n.id===noteId)!);resetEditorTo(editorOriginal.current!);setIsNew(false)}
  setTaskAction(null);
  });
  notify('Перенесено в «'+(toId==='__origin__'?sourceTitle(base,task!):next.notes.find(n=>n.id===toId)?.title||'Без названия')+'»');
 }
 const actionTask=taskAction?(taskAction.fromEditor?editor:board.notes.find(n=>n.id===taskAction.noteId))?.tasks.find(t=>t.id===taskAction.taskId):undefined;
 function exportBoard(){
  const data=editor?{...latest.current,notes:latest.current.notes.some(n=>n.id===editor.id)?latest.current.notes.map(n=>n.id===editor.id?editor:n):[editor,...latest.current.notes]}:latest.current;
  downloadJSON({...data,recovery:{drafts:offline.drafts,conflicts:offline.conflicts}},'oblaka-backup.json');notify('Копия доски подготовлена');
 }
 const active=board.notes.filter(n=>!n.deleted&&!n.archived);const categories=board.categories;
 const displayBoard=useMemo(()=>editor?{...board,notes:[...board.notes.filter(n=>n.id!==editor.id),editor]}:board,[board,editor]);
 const parentOf=useMemo(()=>createParentResolver(board),[board]);
 const todayKey=localDate(new Date());
 const agenda=useMemo(()=>buildAgenda(board,todayKey),[board,todayKey]);
 const editorParentOf=useMemo(()=>createParentResolver(displayBoard),[displayBoard]);
 const availableTags=boardLabels(displayBoard);
 function targetTask(target:TaskTarget|null){return target?(target.fromEditor?editor:board.notes.find(n=>n.id===target.noteId))?.tasks.find(t=>t.id===target.taskId):undefined}
 const pickerTask=targetTask(tagPicker),dueTask=targetTask(duePicker),descriptionTask=targetTask(descriptionEditor),parentTask=targetTask(parentPicker),materialsTask=targetTask(materialsTarget);
 function applyTaskMetadata(target:TaskTarget,changes:Partial<Task>){
  if(!canEdit)return;
  const {noteId,taskId,fromEditor}=target;
  if(fromEditor)setEditor(current=>current?{...current,tasks:current.tasks.map(task=>task.id===taskId?{...task,...changes}:task)}:null);
  else patch(noteId,{tasks:(latest.current.notes.find(n=>n.id===noteId)?.tasks??[]).map(task=>task.id===taskId?{...task,...changes}:task)});
 }
 function applyParent(parent:TaskParent|null){
  if(!parentPicker||!canEdit)return;
  const base=parentPicker.fromEditor?displayBoard:latest.current;
  if(parent&&!canChooseParent(base,parentPicker.taskId,parent.taskId)){notify('Эту задачу нельзя выбрать головной. Выберите другую.');return;}
  applyTaskMetadata(parentPicker,{parent:parent?{...parent,title:base.notes.flatMap(note=>note.tasks).find(task=>task.id===parent.taskId)!.text}:null});
  setParentPicker(null);
 }
 const filtered=board.notes.filter(n=>(view==='trash'?n.deleted:view==='archive'?n.archived&&!n.deleted:!n.deleted&&!n.archived&&(view==='all'||view==='focus'&&isFocusNote(n)||view==='pinned'&&n.pinned||n.category===view))&&(!tagView||noteHasLabel(n,tagView))&&(!query||[n.title,n.text,n.category,...n.tasks.map(t=>t.text+' '+(t.origin?sourceTitle(board,t):'')+' '+taskDescription(t)+' '+taskLabels(t).join(' ')+' '+(parentOf(t)?.title||''))].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())));
 const title=query?'Результаты поиска':tagView?'Тег: '+tagView:view==='all'?'Все облака':view==='focus'?'Задачи':view===TODAY_VIEW?'Сегодня':view==='pinned'?'Закреплённые':view==='archive'?'Архив':view==='trash'?'Корзина':view;
 const canEdit=writeAllowed.current;
 const canRead=ready;
 function nav(id:string){setTagView(null);setView(id);setSidebar(false);setPalette(null)}
 function navTag(label:string){setView('all');setTagView(label);setSidebar(false);setPalette(null)}
 const navItem=(id:string,label:string,icon:React.ReactNode,count?:number)=><button className={'nav-item '+(!tagView&&view===id?'active':'')} onClick={()=>nav(id)}>{icon}<span>{label}</span>{count!==undefined&&<small>{count}</small>}</button>;
 /** «Сегодня»: computed from due dates, never stored. Tapping a task opens its cloud. */
 function renderAgenda(full=false){
  const limit=full?Infinity:10;const total=agenda.reduce((n,g)=>n+g.items.length,0);let shown=0;
  const source=(id:string,fallback:Note)=>latest.current.notes.find(n=>n.id===id)??fallback;
  return <article key="__today__" className={'note color-blue today-note'+(full?' today-full':'')} aria-label="Сегодня" onClick={e=>{if(!full&&!(e.target as HTMLElement).closest('button,a,input'))nav(TODAY_VIEW)}}>
   <div className="note-title today-title">Сегодня</div>
   {!total&&<p className="focus-empty">Здесь появятся дела со сроком. Срок ставится в облаке: смахните дело влево → «Ещё» → «Срок».</p>}
   {agenda.map(group=>{
    if(shown>=limit)return null;const items=group.items.slice(0,limit-shown);shown+=items.length;
    return <div className={'agenda-group'+(group.overdue?' overdue':'')} key={group.key}>
     <div className="agenda-date"><span>{group.label}</span>{group.hint&&<small>{group.hint}</small>}</div>
     <div className="tasks">{items.map(({note,task,time,source:from})=><div className="task-row agenda-row" key={task.id}>
      <TaskCheckbox done={task.done} label={task.text||'Без названия'} disabled={!canEdit} onToggleDone={()=>patch(note.id,{tasks:source(note.id,note).tasks.map(x=>x.id===task.id?{...x,done:!x.done}:x)})}/>
      <button type="button" className="agenda-task" onClick={()=>openEditor(source(note.id,note))}><span className="task-label"><TaskText text={task.text||'Без названия'}/></span><small>{time&&<b>{time} · </b>}{from}</small></button>
     </div>)}</div>
    </div>;
   })}
   {!full&&total>shown&&<button className="show-all-tasks" onClick={()=>nav(TODAY_VIEW)} aria-label="Показать все дела со сроком" title={'Ещё дел: '+(total-shown)}><span aria-hidden="true">…</span></button>}
  </article>;
 }
 // «Сегодня» sits right after «Задачи» among the pinned clouds on the main board.
 const showAgenda=!query&&!tagView&&(view==='all'||view==='pinned');
 function pinnedCards(){
  const pinned=filtered.filter(n=>n.pinned),cards=pinned.map(renderCard);
  if(showAgenda)cards.splice(pinned.findIndex(isFocusNote)+1,0,renderAgenda());
  return cards;
 }
 function renderCard(n:Note){
  const display=pinnedFirst(n.tasks.filter(t=>!t.done));const matches=query?display.filter(t=>[t.text,taskDescription(t),parentOf(t)?.title,...taskLabels(t)].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())):[];const queryTasks=matches.length?matches:display;const cardTasks=tagView?queryTasks.filter(t=>hasLabel(taskLabels(t),tagView)):queryTasks;const previewTasks=cardTasks.slice(0,8);
  return <article className={'note color-'+n.color+(n.deleted?' deleted':'')+(isFocusNote(n)?' focus-note':'')} data-note-id={n.id} key={n.id} onClick={e=>{
    // A tap anywhere on the card opens the cloud, including empty task rows and gaps.
    // Controls with their own action (checkbox, pin, tools, palette, inputs) keep it.
    if((e.target as HTMLElement).closest('button,a,input,textarea,select,form,.palette,.drag-handle'))return;
    if(Date.now()-dragEndedAt.current<500)return; // the click that ends a drag
    if(canRead&&!n.deleted)openEditor(n);
   }}>
   <div className="note-top"><button className="drag-handle icon-button" aria-label={'Перетащить облако '+n.title} title="Потяните, чтобы переместить. С клавиатуры: ↑ и ↓" onPointerDown={e=>startDrag(e,'note',n)} onKeyDown={e=>keyboardMove(e,n)} disabled={!canEdit}><GripVertical size={18}/></button>{n.example&&<span className="example">ПРИМЕР</span>}{isFocusNote(n)&&<span className="focus-badge">TO-DO</span>}<button className={'pin icon-button '+(n.pinned?'is-pinned':'')} title={n.pinned?'Открепить':'Закрепить'} aria-label={n.pinned?'Открепить '+n.title:'Закрепить '+n.title} onClick={()=>patch(n.id,{pinned:!n.pinned})} disabled={!canEdit||n.deleted||isFocusNote(n)}><Pin size={17} fill={n.pinned?'currentColor':'none'}/></button></div>
   <button className="note-title" onClick={()=>{openEditor(n)}} disabled={!canRead||n.deleted}>{n.title||'Без названия'}</button>
   {!n.tasks.length&&!isFocusNote(n)&&n.text&&<p className="note-text">{n.text}</p>}
   {!!previewTasks.length&&<div className="tasks">{previewTasks.map(t=><div key={t.id} className="swipe-task"><div className="swipe-content no-task-menu"><div className={'task-row '+(t.done?'done':'')+(parentOf(t)?' subtask':'')} key={t.id} data-task-id={t.id}>
    <button className="task-drag drag-handle" title="Перетащить задачу" aria-label={'Перетащить задачу '+t.text} disabled={!canEdit||n.deleted} onPointerDown={e=>startDrag(e,'task',n,t)} onKeyDown={e=>keyboardMove(e,n,t)}><GripVertical size={14}/></button>
    <TaskCheckbox done={t.done} focused={t.focused} label={t.text} disabled={!canEdit||n.deleted}
     onToggleDone={()=>patch(n.id,{tasks:n.tasks.map(x=>x.id===t.id?{...x,done:!x.done}:x)})}/>
    <div className="task-copy"><span className="task-label"><TaskText text={t.text}/></span>
     <TaskDetails task={t} parentTitle={parentOf(t)?.title}/>
    </div>
   </div></div></div>)}</div>}
   {cardTasks.length>previewTasks.length&&<button className="show-all-tasks" onClick={()=>{openEditor(n)}} disabled={!canRead||n.deleted} aria-label={"Показать все задачи: "+n.title} title={"Ещё задач: "+(cardTasks.length-previewTasks.length)}><span aria-hidden="true">…</span></button>}
   {isFocusNote(n)&&!n.tasks.length&&<p className="focus-empty">Откройте облако, смахните дело вправо и нажмите «В задачи» — оно появится здесь.</p>}
   {!n.deleted&&!isFocusNote(n)&&<form className="inline-add" onSubmit={e=>{e.preventDefault();const input=e.currentTarget.elements.namedItem('task') as HTMLInputElement;addTask(n,input.value);input.value=''}}><Plus size={15}/><input name="task" placeholder={layout==='grid'?'Задача…':'Добавить задачу'} aria-label={'Новая задача в '+n.title} disabled={!canEdit}/></form>}
   <div className="note-bottom">{n.category?<button className="tag" title={"Тема: "+n.category} onClick={()=>nav(n.category)}>{n.category}</button>:<span/>}<div className="card-tools">
    {isFocusNote(n)?<span className="focus-card-hint">Откройте, чтобы вернуть дело в облако</span>:n.deleted?<button className="icon-button" title="Восстановить" aria-label={'Восстановить '+n.title} onClick={()=>{patch(n.id,{deleted:false});notify('Облако восстановлено')}} disabled={!canEdit}><RotateCcw size={16}/></button>:<><button className="icon-button" title="Цвет облака" aria-label={'Цвет облака '+n.title} onClick={()=>setPalette(palette===n.id?null:n.id)} disabled={!canEdit}><Palette size={16}/></button><button className="icon-button" title={n.archived?'Вернуть на доску':'В архив'} aria-label={n.archived?'Вернуть '+n.title:'В архив '+n.title} onClick={()=>{patch(n.id,{archived:!n.archived});notify(n.archived?'Облако возвращено на доску':'Облако в архиве')}} disabled={!canEdit}><Archive size={16}/></button><button className="icon-button" title="В корзину" aria-label={'В корзину '+n.title} onClick={()=>{patch(n.id,{deleted:true});notify('В корзине. Можно восстановить в меню слева.')}} disabled={!canEdit}><Trash2 size={16}/></button></>}
   </div></div>
   {palette===n.id&&<div className="palette">{colors.map((c,i)=><button key={c} aria-label={colorNames[i]} title={colorNames[i]} className={'swatch color-'+c+(n.color===c?' selected':'')} onClick={()=>{patch(n.id,{color:c});setPalette(null)}}>{n.color===c&&<Check size={14}/>}</button>)}</div>}
  </article>;
 }
 if(!ready&&!demo)return <div className="access-screen"><Cloud size={48}/><h1>{error?status:'Открываем облака'}</h1><p>{error||'Загружаем общую доску.'}</p>{error&&<><button className="secondary" onClick={()=>load()}>Обновить</button><a className="secondary" href={signInHref("/")} target="_top">Войти</a></>}</div>;
 return <div className={'app-shell keep-layout'+(organizing?' organizing':'')+(!canEdit?' readonly-board':'')}>
  {sidebar&&<div className="sidebar-scrim" onClick={()=>setSidebar(false)}/>}
  <aside className={'sidebar '+(sidebar?'open':'')}>
   <a className="brand" href="/" aria-label="Облака — главная"><span className="brand-mark"><Cloud size={27} strokeWidth={1.65}/></span><span>облака<span className="brand-dot">.</span></span></a>
   <div className="workspace-label">ЛИЧНОЕ ПРОСТРАНСТВО</div>
   <nav>{navItem('all','Все облака',<LayoutGrid size={18}/>,active.length)}{navItem('focus','Задачи',<CheckCheck size={18}/>,board.notes.find(isFocusNote)?.tasks.filter(t=>!t.done).length||0)}{navItem(TODAY_VIEW,'Сегодня',<CalendarDays size={18}/>,agendaUrgentCount(agenda,todayKey)||undefined)}{navItem('pinned','Закреплённые',<Pin size={18}/>,active.filter(n=>n.pinned).length)}</nav>
   {canEdit&&<nav className="mobile-create-nav"><button className="nav-item" onClick={()=>{setSidebar(false);setPalette(null);openNew()}}><Plus size={18}/><span>Новое облако</span></button></nav>}
   {!!availableTags.length&&<><div className="nav-heading"><span>ТЕГИ</span></div><nav>{availableTags.map(label=><button key={label} className={"nav-item "+(tagView===label?"active":"")} onClick={()=>navTag(label)}><Tag size={17}/><span>{label}</span><small>{active.filter(note=>noteHasLabel(note,label)).length||""}</small></button>)}</nav></>}
   <div className="nav-heading"><span>МОИ ТЕМЫ</span><button aria-label="Добавить тему" title="Добавить тему" onClick={()=>setCategoryModal(true)} disabled={!canEdit}><Plus size={16}/></button></div>
   <nav>{categories.map((c,i)=><button className={'nav-item '+(view===c?'active':'')} key={c} onClick={()=>nav(c)}><span className={'category-dot dot-'+(i%5)}/><span>{c}</span><small>{active.filter(n=>n.category===c).length||''}</small></button>)}<button className="nav-item add-topic" onClick={()=>setCategoryModal(true)} disabled={!canEdit}><Plus size={17}/><span>Новая тема</span></button></nav>
   <div className="nav-divider"/><nav>{navItem('archive','Архив',<Archive size={18}/>)}{navItem('trash','Корзина',<Trash2 size={18}/>)}</nav>
   <div className="sidebar-bottom">
    {canAdmin(session?.role??null)&&<a href="/admin" className="help-link admin-nav"><ShieldCheck size={18}/>Пользователи и доступ</a>}
    <button className="help-link" onClick={exportBoard}><Download size={18}/>Скачать копию доски</button>
    {board.notes.some(n=>n.example&&!n.deleted)&&<button className="help-link" onClick={()=>setRemoveExamples(true)} disabled={!canEdit}><X size={18}/>Убрать примеры</button>}
    <button className="help-link" onClick={()=>setHelp(true)}><CircleHelp size={18}/>Как это работает</button>
    {!!board.imports?.length&&<p className="sidebar-import">Из Todoist: {board.imports.reduce((sum,item)=>sum+item.taskCount,0)} задач</p>}
    <div className="profile"><span className="avatar">А</span><div><strong>{session?.name||'Общее пространство'}</strong><small>{session?roleNames[session.role]:''}</small></div></div>
    {!demo&&<a href={signOutHref} target="_top" className="help-link" onClick={async e=>{e.preventDefault();await controller.lock();location.assign(signOutHref)}}><LogOut size={18}/>Выйти из аккаунта</a>}
   </div>
  </aside>
  <div className="main-shell">
   <header className="topbar">
    <button className="icon-button mobile-menu" aria-label="Открыть меню" onClick={()=>setSidebar(true)}><Menu size={25}/></button>
    <div className="search"><Search size={21}/><input placeholder="Искать в заметках" aria-label="Поиск по облакам" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button className="icon-button" aria-label="Очистить поиск" onClick={()=>setQuery('')}><X size={20}/></button>}</div>
    <button className="icon-button layout-toggle" aria-label={layout==='grid'?'Показать списком':'Показать сеткой'} title={layout==='grid'?'Список':'Сетка'} onClick={()=>chooseLayout(layout==='grid'?'list':'grid')}>{layout==='grid'?<Rows2 size={23}/>:<LayoutGrid size={23}/>}</button>
    <button className={'icon-button organize-toggle'+(organizing?' selected':'')} aria-label={organizing?'Завершить перестановку':'Переставить облака'} aria-pressed={organizing} title="Переставить облака" disabled={!canEdit} onClick={()=>{setOrganizing(!organizing);setPalette(null)}}><ArrowDownUp size={23}/></button>
    <button className={'account-status'+(error?' has-error':'')} title={status} aria-label={'Состояние сохранения: '+status} onClick={()=>notify(status+(offline.offlineReady?" · Готово к открытию без сети":" · Для подготовки офлайна оставьте страницу открытой с интернетом"))}><span>{session?.name?.slice(0,1)||'А'}</span><i/></button>
   </header>
   <main><h1 className={view==='all'&&!tagView&&!query?'sr-only':'context-heading'}>{title}</h1>
    {organizing&&<div className="organize-hint"><GripVertical size={17}/><span>Перетаскивайте за точки</span><button onClick={()=>{setOrganizing(false);setPalette(null)}}>Готово</button></div>}
    {notice&&<div className="error-banner" role="alert">
     <TriangleAlert size={18}/>
     <span>{notice.message}</span>
     <button onClick={exportBoard}>Скачать копию</button>
     {!conflict&&!offline.storageFailed&&!offline.tooLarge&&<button disabled={offline.syncing} onClick={()=>void load()}>Повторить</button>}
    </div>}
    {offline.legacy&&<div className="error-banner"><span>Найдена старая несинхронизированная копия. Скачайте её для сверки с текущей доской.</span><button onClick={()=>{downloadJSON(offline.legacy,'oblaka-recovered.json')}}>Скачать копию</button></div>}
    {!canEdit&&!conflict&&<div className="viewer-notice"><Eye size={15}/>Общая доска · только просмотр</div>}
    {demo&&<div className="preview-banner">Предпросмотр · изменения сохраняются только в этом браузере</div>}
    {canEdit&&!['archive','trash','focus',TODAY_VIEW].includes(view)&&<form className="composer" onSubmit={e=>{e.preventDefault();openNew()}}><span className="composer-plus"><Plus size={22}/></span><input aria-label="Название нового облака" placeholder="Новая заметка…" value={quick} onChange={e=>setQuick(e.target.value)} disabled={!canEdit}/><button type="button" className="composer-list" onClick={()=>openNew(true)} title="Создать список" disabled={!canEdit}><CheckCheck size={20}/><span>Список</span></button><span className="composer-divider"/><button className="create-button" disabled={!canEdit}><span>Создать облако</span><Plus size={17}/></button></form>}

    {view===TODAY_VIEW?<section className="today-section"><MasonryNotes layout="list">{renderAgenda(true)}</MasonryNotes></section>:!filtered.length?<div className="empty"><div className="empty-cloud"><Cloud size={66} strokeWidth={1}/><span>✧</span></div><h2>{query?'Пока ничего не нашлось':view==='trash'?'Корзина пуста':view==='archive'?'Здесь пока тихо':'Место для нового облака'}</h2><p>{query?'Попробуйте другое слово или уберите поиск.':view==='trash'?'Удалённые облака можно будет восстановить здесь.':view==='archive'?'Отправьте сюда то, что больше не нужно держать на виду.':'Запишите мысль, добавьте дела — и расставьте всё по-своему.'}</p>{!query&&!['archive','trash'].includes(view)&&<button className="primary" onClick={()=>openNew()} disabled={!canEdit}><Plus size={17}/>Создать облако</button>}</div>:<>
     {(filtered.some(n=>n.pinned)||showAgenda)&&<section><div className="section-label"><Pin size={13}/><h2>Закреплённые</h2><span>{filtered.filter(n=>n.pinned).length}</span></div><MasonryNotes layout={layout}>{pinnedCards()}</MasonryNotes></section>}
     {filtered.some(n=>!n.pinned)&&<section><div className="section-label"><Cloud size={14}/><h2>{filtered.some(n=>n.pinned)?'Другие заметки':'Заметки'}</h2><span>{filtered.filter(n=>!n.pinned).length}</span><small>Перетаскивайте за <GripVertical size={13}/></small></div><MasonryNotes layout={layout}>{filtered.filter(n=>!n.pinned).map(renderCard)}</MasonryNotes></section>}
    </>}

   </main>
  </div>
  {dragVisual&&<div className={'drag-ghost'+(dragVisual.color?' color-'+dragVisual.color:'')} style={{left:dragVisual.x+12,top:dragVisual.y+12}}><GripVertical size={16}/>{dragVisual.label}</div>}
  {toast&&<div className="toast" role="status"><Check size={17}/>{toast}</div>}
  {editor&&<Modal focusPanel label={!canEdit?'Просмотр облака':isNew?'Новое облако':'Редактирование облака'} onClose={saveEditor}>
   <div ref={editorElement} className={'editor color-'+editor.color+(!canEdit?' readonly-editor':'')} onPointerDownCapture={event=>{if((event.target as HTMLElement).matches('input,textarea'))editorHistory.breakGroup()}} onKeyDownCapture={event=>{
    if(!canEdit||event.nativeEvent.isComposing)return;
    const key=event.code==='KeyZ'?'z':event.code==='KeyY'?'y':event.key.toLowerCase();
    if((event.ctrlKey||event.metaKey)&&!event.altKey&&(key==='z'||key==='y')){event.preventDefault();event.stopPropagation();stepEditorHistory(key==='y'||event.shiftKey?'redo':'undo')}
    else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))editorHistory.breakGroup();
   }}>
    <div className="editor-top"><button className="icon-button" aria-label="Назад к облакам" onClick={saveEditor}><ArrowLeft size={23}/></button><span>{isFocusNote(editor)?'ВРЕМЕННЫЙ СПИСОК ДЕЛ':isNew?'НОВОЕ ОБЛАКО':'ВАШЕ ОБЛАКО'}</span>
     <button className="icon-button editor-pin" aria-label={editor.pinned?'Открепить облако':'Закрепить облако'} title={editor.pinned?'Открепить облако':'Закрепить облако'} aria-pressed={editor.pinned} disabled={!canEdit||isFocusNote(editor)} onClick={()=>setEditor({...editor,pinned:!editor.pinned})}><Pin size={20} fill={editor.pinned?'currentColor':'none'}/></button>
     <button className="icon-button" aria-label="Сохранить и закрыть" onClick={saveEditor}><X size={22}/></button>
    </div>
    <input readOnly={!canEdit||isFocusNote(editor)} className="editor-title" aria-label="Заголовок облака" placeholder="Название облака" value={editor.title} maxLength={300} onChange={e=>setEditor({...editor,title:e.target.value},'title')}/>
    {!isFocusNote(editor)&&!editor.tasks.length&&<textarea readOnly={!canEdit} className="editor-text" placeholder="О чём думаете? Можно просто писать…" aria-label="Текст заметки" value={editor.text} onChange={e=>setEditor({...editor,text:e.target.value},'text')}/>}
    <EditorTaskList readOnly={!canEdit} tasks={editor.tasks} focusMode={isFocusNote(editor)} getSourceTitle={t=>sourceTitle(board,t)} getParentTitle={t=>editorParentOf(t)?.title} onToggleFocus={id=>toggleTaskFocus(editor.id,id,true)} onMoveToCloud={id=>openTaskActions(editor.id,id,true,'cloud')} onMore={id=>openTaskActions(editor.id,id,true,'more')} onChange={(tasks,group)=>setEditor(current=>current?{...current,tasks}:null,group)}/>
    {isFocusNote(editor)&&!editor.tasks.length&&<p className="focus-empty">Пока пусто. Откройте другое облако, смахните дело вправо и нажмите «В задачи».</p>}
    {canEdit&&!isFocusNote(editor)&&<button className="add-editor-task" onClick={()=>{setEditor({...editor,tasks:[...editor.tasks,{id:uid(),text:'',done:false}]});setTimeout(()=>{const inputs=document.querySelectorAll<HTMLTextAreaElement>('.editor-task textarea');inputs[inputs.length-1]?.focus()},30)}}><Plus size={17}/>Добавить задачу</button>}
    {canEdit&&<div className="editor-settings"><div className="color-options">{colors.map((c,i)=><button key={c} className={'swatch color-'+c+(editor.color===c?' selected':'')} aria-label={colorNames[i]} title={colorNames[i]} onClick={()=>setEditor({...editor,color:c})}>{editor.color===c&&<Check size={14}/>}</button>)}</div>
    <EditorHistoryControls canUndo={editorHistory.canUndo} canRedo={editorHistory.canRedo} onUndo={()=>stepEditorHistory('undo')} onRedo={()=>stepEditorHistory('redo')}/>
    </div>}
    {(offline.storageFailed||offline.tooLarge)&&<small className="editor-save-status" role="alert">{offline.tooLarge?notice?.message:error}</small>}
    <div className="editor-footer">{canEdit&&!isNew&&!isFocusNote(editor)&&<div className="editor-extra-actions"><button className="icon-button" aria-label={editor.archived?'Вернуть на доску':'В архив'} onClick={()=>saveEditorWith({archived:!editor.archived})}><Archive size={21}/></button><button className="icon-button" aria-label="В корзину" onClick={()=>saveEditorWith({deleted:true})}><Trash2 size={21}/></button></div>}{canEdit&&<button className="text-button" onClick={cancelEditor}>Отменить</button>}<button className="primary" onClick={saveEditor}><Check size={17}/>Готово</button></div>
   </div>
  </Modal>}
  {editor&&confirmCancel&&<Modal focusPanel label="Отменить изменения" onClose={()=>setConfirmCancel(false)}><div className="small-modal"><h2>Отменить изменения?</h2><p>{isNew?'Новое облако не будет создано.':'Правки в этом облаке пропадут.'} Чтобы сохранить, нажмите «Готово».</p><div className="modal-actions"><button className="text-button" onClick={discardEditor}>Отменить изменения</button><button className="primary" autoFocus onClick={()=>setConfirmCancel(false)}>Продолжить редактирование</button></div></div></Modal>}

  {categoryModal&&<Modal label="Новая тема" onClose={()=>setCategoryModal(false)}><form className="small-modal" onSubmit={e=>{e.preventDefault();const c=newCategory.trim();if(c&&!categories.includes(c)){update(b=>({...b,categories:[...b.categories,c]}));setNewCategory('');setCategoryModal(false);nav(c)}}}><h2>Новая тема</h2><p>Чтобы близкие мысли были рядом.</p><input autoFocus placeholder="Например, Путешествия" aria-label="Название темы" value={newCategory} maxLength={60} onChange={e=>setNewCategory(e.target.value)}/><div className="modal-actions"><button type="button" className="text-button" onClick={()=>setCategoryModal(false)}>Отмена</button><button className="primary" disabled={!newCategory.trim()||categories.includes(newCategory.trim())}>Добавить</button></div></form></Modal>}
  {removeExamples&&<Modal label="Убрать примеры" onClose={()=>setRemoveExamples(false)}><div className="small-modal"><h2>Начать с чистого листа?</h2><p>Все облака с меткой «Пример» переместятся в корзину. Их можно будет вернуть.</p><div className="modal-actions"><button className="text-button" onClick={()=>setRemoveExamples(false)}>Оставить</button><button className="primary" onClick={()=>{update(b=>({...b,notes:b.notes.map(n=>n.example?{...n,deleted:true}:n)}));setRemoveExamples(false)}}>Убрать примеры</button></div></div></Modal>}
  {taskAction&&actionTask&&canEdit&&<Modal label={taskAction.mode==='cloud'?'Перенести в облако':'Действия с задачей'} onClose={()=>setTaskAction(null)}><div className="small-modal task-actions-modal">
   <h2>{taskAction.mode==='cloud'?'В облако':'Действия с задачей'}</h2><p>{actionTask.text}</p>
   {taskAction.mode==='more'?<><TaskAiLinksEditor key={actionTask.id} task={actionTask} onApply={changes=>applyTaskMetadata(taskAction,changes)}/><div className="task-action-options">
    <button onClick={()=>{setTagPicker({noteId:taskAction.noteId,taskId:taskAction.taskId,fromEditor:taskAction.fromEditor});setTaskAction(null)}}><Tag size={18}/>Теги</button>
    <button onClick={()=>{setDuePicker({noteId:taskAction.noteId,taskId:taskAction.taskId,fromEditor:taskAction.fromEditor});setTaskAction(null)}}><CalendarDays size={18}/>Срок</button>
    <button onClick={()=>{setDescriptionEditor({noteId:taskAction.noteId,taskId:taskAction.taskId,fromEditor:taskAction.fromEditor});setTaskAction(null)}}><AlignLeft size={18}/>Описание</button>
    <button onClick={()=>{setMaterialsTarget({noteId:taskAction.noteId,taskId:taskAction.taskId,fromEditor:taskAction.fromEditor});setTaskAction(null)}}><Paperclip size={18}/>Комментарии и материалы</button>
    <button onClick={()=>{setParentPicker({noteId:taskAction.noteId,taskId:taskAction.taskId,fromEditor:taskAction.fromEditor});setTaskAction(null)}}><CornerDownRight size={18}/>Головная задача</button>
    <button onClick={()=>changeActionTask({pinned:!actionTask.pinned})}><Pin size={18}/>{actionTask.pinned?'Открепить':'Закрепить'}</button>
    {taskAction.noteId!==FOCUS_NOTE_ID&&<button onClick={()=>moveActionTask(FOCUS_NOTE_ID)}><CheckCheck size={18}/>В задачи</button>}
    <button onClick={()=>openTaskActions(taskAction.noteId,taskAction.taskId,taskAction.fromEditor,'cloud')}><Cloud size={18}/>В облако</button>
    <button onClick={()=>changeActionTask({done:!actionTask.done})}><Check size={18}/>{actionTask.done?'Вернуть в активные':'Выполнить'}</button>
   </div></>:<>
    {taskAction.noteId===FOCUS_NOTE_ID&&actionTask.origin&&<button className="return-origin" onClick={()=>moveActionTask('__origin__')}><RotateCcw size={18}/>Вернуть в «{sourceTitle(board,actionTask)}»</button>}
    <input autoFocus placeholder="Найти облако" aria-label="Найти облако для задачи" value={cloudQuery} onChange={e=>setCloudQuery(e.target.value)}/>
    <div className="cloud-choice-list">{board.notes.filter(n=>!n.deleted&&!n.archived&&!isFocusNote(n)&&n.id!==taskAction.noteId&&n.title.toLocaleLowerCase().includes(cloudQuery.toLocaleLowerCase())).map(n=><button key={n.id} onClick={()=>moveActionTask(n.id)}><span className={'cloud-choice-dot color-'+n.color}/>{n.title||'Без названия'}</button>)}</div>
   </>}
   <div className="modal-actions"><button className="secondary" onClick={()=>setTaskAction(null)}>Закрыть</button></div>
  </div></Modal>}
  {tagPicker&&pickerTask&&canEdit&&<Modal label="Теги задачи" onClose={()=>setTagPicker(null)}><TagPicker title="Теги задачи" options={availableTags} value={taskLabels(pickerTask)} onApply={labels=>{applyTaskMetadata(tagPicker,{labels});setTagPicker(null)}} onCancel={()=>setTagPicker(null)}/></Modal>}
  {duePicker&&dueTask&&canEdit&&<Modal label="Срок задачи" onClose={()=>setDuePicker(null)}><DuePicker value={taskDueDate(dueTask)} onApply={dueDate=>{applyTaskMetadata(duePicker,{dueDate});setDuePicker(null)}} onCancel={()=>setDuePicker(null)}/></Modal>}
  {descriptionEditor&&descriptionTask&&canEdit&&<Modal label="Описание задачи" onClose={()=>setDescriptionEditor(null)}><TaskDescriptionEditor materials={<TaskMaterials key={descriptionTask.id} task={descriptionTask}/>} value={taskDescription(descriptionTask)} onApply={description=>{applyTaskMetadata(descriptionEditor,{description});setDescriptionEditor(null)}} onCancel={()=>setDescriptionEditor(null)}/></Modal>}
  {materialsTarget&&materialsTask&&canEdit&&<Modal label="Комментарии и материалы" onClose={()=>setMaterialsTarget(null)}><div className="small-modal"><TaskMaterials key={materialsTask.id} task={materialsTask}/><div className="modal-actions"><button type="button" className="secondary" onClick={()=>setMaterialsTarget(null)}>Закрыть</button></div></div></Modal>}
  {parentPicker&&parentTask&&canEdit&&<Modal label="Головная задача" onClose={()=>setParentPicker(null)}><TaskParentPicker board={parentPicker.fromEditor?displayBoard:board} task={parentTask} onApply={applyParent} onCancel={()=>setParentPicker(null)}/></Modal>}
  {conflict&&<Modal focusPanel label="Конфликт изменений" onClose={()=>{}}><SyncConflicts conflicts={offline.conflicts} onResolve={choices=>controller.resolve(choices)} onExport={exportBoard}/></Modal>}
  {help&&<Modal label="Как это работает" onClose={()=>setHelp(false)}><div className="small-modal help-modal"><div className="help-cloud"><Cloud size={37}/></div><h2>Порядок без правил</h2><p>Облако — это заметка, список дел или всё сразу.</p><div className="help-row"><Plus/><div><strong>Запишите, пока не забыли</strong><p>Откройте меню ☰ → «Новое облако» (на компьютере — строка вверху доски). Облако может быть заметкой, списком дел или всем сразу.</p></div></div><div className="help-row"><GripVertical/><div><strong>Расставьте по-своему</strong><p>Нажмите ↕ вверху, затем тяните за точки, чтобы двигать карточки и задачи, в том числе внутри открытого облака. Задачу можно перенести в другое облако. С клавиатуры: фокус на точках, затем ↑ или ↓.</p></div></div><div className="help-row"><CheckCheck/><div><strong>Соберите задачи на сейчас</strong><p>Откройте облако и смахните дело влево → «Ещё», чтобы выбрать теги, установить срок, изменить описание или головную задачу. Эти поля относятся только к выбранной задаче. Смахните вправо: «Закрепить» и «В задачи» в обычном облаке, «Закрепить» и «В облако» в списке «Задачи». В «Задачах» исходное облако показано значком облака. Это отдельное поле «Облако». Теги Todoist («идея», «жду» и другие) остаются самостоятельными метками со значком бирки. Галочка отмечает выполнение. Без свайпа все действия доступны через кнопку «…» у дела.</p></div></div><div className="help-row"><Palette/><div><strong>Добавьте свой порядок</strong><p>Цвета, темы и закрепление помогают держать важное на виду. Нажмите на заголовок, чтобы изменить облако.</p></div></div><div className="help-row"><CloudCheck/><div><strong>Всё сохраняется</strong><p>{demo?'Это предпросмотр. На опубликованном сайте доска сохраняется в аккаунте.':'После первого открытия с интернетом доска доступна офлайн. Правки и черновики сохраняются на этом устройстве. Синхронизация возобновляется, когда сайт открыт и связь восстановлена. Если одно поле изменено на двух устройствах, выберите нужную версию. На общем устройстве выход из аккаунта закрывает офлайн-доступ.'}</p></div></div><button className="primary" onClick={()=>setHelp(false)}>Понятно</button></div></Modal>}
 </div>;
}
function Modal({children,label,onClose,focusPanel=false}:{children:React.ReactNode;label:string;onClose:()=>void;focusPanel?:boolean}){const ref=useRef<HTMLDivElement>(null);const close=useRef(onClose);close.current=onClose;useEffect(()=>{const old=document.activeElement as HTMLElement;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';if(focusPanel)ref.current?.focus({preventScroll:true});const handler=(e:KeyboardEvent)=>{const dialogs=document.querySelectorAll('[role=dialog]');if(dialogs[dialogs.length-1]!==ref.current)return;if(e.key==='Escape')close.current();if(e.key==='Tab'){const els=ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select,a[href]');if(!els?.length)return;const first=els[0],last=els[els.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};document.addEventListener('keydown',handler);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',handler);old?.focus()}},[]);return <div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div role="dialog" aria-modal="true" aria-label={label} className="modal-panel" tabIndex={-1} ref={ref}>{children}</div></div>}

function downloadJSON(value:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
