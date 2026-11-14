import {isFocusNote,sourceTitle,taskDueDate,type Board,type Note,type Task} from './board-model.ts';
import {dueParts,makeDueDate,validDate} from './task-due.ts';

// «Сегодня» is computed, never stored: every unfinished task with a due date from the
// visible clouds, grouped by date. A member's board is already filtered, so they only
// see tasks from their own clouds.

export const TODAY_VIEW='today';
export type AgendaItem={note:Note;task:Task;date:string;time:string;source:string};
export type AgendaGroup={key:string;label:string;hint:string;overdue:boolean;items:AgendaItem[]};

const WEEKDAYS=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
export const addAgendaDays=(date:string,days:number)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
export function dateLabel(date:string){return `${date.slice(8,10)}.${date.slice(5,7)} ${WEEKDAYS[new Date(date+'T12:00:00Z').getUTCDay()]}`}

/** `today` is the viewer's local date, YYYY-MM-DD. */
export function buildAgenda(board:Board,today:string):AgendaGroup[]{
 const items:AgendaItem[]=[];
 for(const note of board.notes){
  if(note.deleted||note.archived)continue;
  for(const task of note.tasks){
   if(task.done)continue;
   const {date,time}=dueParts(taskDueDate(task));if(!date)continue;
   items.push({note,task,date,time,source:isFocusNote(note)?sourceTitle(board,task):note.title||'Без названия'});
  }
 }
 // Within a day: tasks without a time first, then by time.
 items.sort((a,b)=>a.date.localeCompare(b.date)||((a.task.agendaOrder??Infinity)-(b.task.agendaOrder??Infinity)||0)||(a.time?1:0)-(b.time?1:0)||a.time.localeCompare(b.time));
 const groups:AgendaGroup[]=[];
 const overdue=items.filter(item=>item.date<today);
 if(overdue.length)groups.push({key:'overdue',label:'Просрочено',hint:'',overdue:true,items:overdue});
 const tomorrow=addAgendaDays(today,1);
 for(const item of items){
  if(item.date<today)continue;
  let group=groups.at(-1);
  if(!group||group.key!==item.date){
   group={key:item.date,label:dateLabel(item.date),hint:item.date===today?'сегодня':item.date===tomorrow?'завтра':'',overdue:false,items:[]};
   groups.push(group);
  }
  group.items.push(item);
 }
 return groups;
}

/** Shown as the count next to «Сегодня» in the menu: overdue and due today. */
export const agendaUrgentCount=(groups:AgendaGroup[],today:string)=>groups.filter(g=>g.overdue||g.key===today).reduce((n,g)=>n+g.items.length,0);

/** Each drop zone names a real date, including individual overdue dates. */
export function agendaDays(groups:AgendaGroup[],today:string,withEmpty=false):AgendaGroup[]{
 const days=new Map<string,AgendaGroup>();
 for(const group of groups)for(const item of group.items){
  if(!days.has(item.date))days.set(item.date,{key:item.date,label:dateLabel(item.date),hint:item.date<today?'просрочено':item.date===today?'сегодня':item.date===addAgendaDays(today,1)?'завтра':'',overdue:item.date<today,items:[]});
  days.get(item.date)!.items.push(item);
 }
 if(withEmpty)for(const date of [today,addAgendaDays(today,1)])if(!days.has(date))days.set(date,{key:date,label:dateLabel(date),hint:date===today?'сегодня':'завтра',overdue:false,items:[]});
 return [...days.values()].sort((a,b)=>a.key.localeCompare(b.key));
}

/** Move only the due date and day ordering; ownership, task IDs and metadata stay intact. */
export function moveAgendaTask(board:Board,today:string,taskId:string,date:string,beforeId:string|null=null):Board{
 if(!validDate(date)||beforeId===taskId)return board;
 const groups=buildAgenda(board,today),all=groups.flatMap(group=>group.items),source=all.find(item=>item.task.id===taskId);
 if(!source)return board;
 const original=all.filter(item=>item.date===date),destination=original.filter(item=>item.task.id!==taskId);
 const before=destination.findIndex(item=>item.task.id===beforeId);
 destination.splice(before<0?destination.length:before,0,source);
 if(source.date===date&&original.every((item,index)=>item.task.id===destination[index]?.task.id))return board;
 const dueDate=source.date===date?taskDueDate(source.task):makeDueDate(date,source.time);
 if(!dueDate)return board;
 const order=new Map(destination.map((item,index)=>[item.task.id,index]));
 return {...board,notes:board.notes.map(note=>{
  if(!note.tasks.some(task=>order.has(task.id)))return note;
  return {...note,tasks:note.tasks.map(task=>order.has(task.id)?{...task,agendaOrder:order.get(task.id),...(task.id===taskId?{dueDate}:{})}:task)};
 })};
}

/**
 * Enter in «Сегодня», as in any cloud: the text before the caret stays, the text after it
 * becomes a new task right below. The new task lives in the same cloud as the original
 * (in «Задачи» it keeps the same source cloud) and gets the same day, without a time.
 */
export function splitAgendaTask(board:Board,today:string,taskId:string,before:string,after:string,createId:()=>string=()=>crypto.randomUUID()):{board:Board;newId:string}|null{
 const all=buildAgenda(board,today).flatMap(group=>group.items),index=all.findIndex(item=>item.task.id===taskId);
 if(index<0)return null;
 const {note,task,date}=all[index];
 if(note.tasks.length>=500)return null;
 const newId=createId();
 const created:Task={id:newId,text:after,done:false,dueDate:date,...(task.pinned?{pinned:true}:{}),...(isFocusNote(note)&&task.origin?{focused:true,origin:task.origin}:{})};
 const inserted:Board={...board,notes:board.notes.map(item=>{
  if(item.id!==note.id)return item;
  const tasks=item.tasks.map(t=>t.id===taskId?{...t,text:before}:t),at=tasks.findIndex(t=>t.id===taskId);
  tasks.splice(at+1,0,created);return {...item,tasks};
 })};
 const next=all.slice(index+1).find(item=>item.date===date)?.task.id??null;
 return {board:moveAgendaTask(inserted,today,newId,date,next),newId};
}
