import {type Board,type Note,type Task,FOCUS_NOTE_ID} from './board-model.ts';

export type SyncOperation={id:string;base:Board;data:Board};
export type MergeConflict={key:string;title:string;field:string;base:unknown;local:unknown;remote:unknown};
export type Choices=Record<string,'local'|'remote'>;
type Entity=Record<string,unknown>;
// Order keys are namespaced: a cloud's id is user data and may be any string, including "notes".
type Flat={entities:Map<string,Entity>;orders:Map<string,string[]>};
const BOARD_ORDER='board:notes',taskOrder=(noteId:string)=>'tasks:'+noteId;
export function equal(a:unknown,b:unknown):boolean{
 if(Object.is(a,b))return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>equal(v,b[i]));
 const x=a as Entity,y=b as Entity;const keys=new Set([...Object.keys(x),...Object.keys(y)]);
 return [...keys].every(k=>equal(x[k],y[k]));
}
function flatten(board:Board):Flat{
 const entities=new Map<string,Entity>(),orders=new Map<string,string[]>();orders.set(BOARD_ORDER,board.notes.map(n=>n.id));
 for(const note of board.notes){const {tasks,...n}=note;entities.set('n:'+note.id,n);orders.set(taskOrder(note.id),tasks.map(t=>t.id));
  for(const task of tasks){const {focused,origin,...t}=task;entities.set('t:'+task.id,{...t,location:{noteId:note.id,...focused!==undefined?{focused}:{},...origin?{origin}:{}}});}
 }
 return {entities,orders};
}
const fields:Record<string,string>={text:'Текст',title:'Название',done:'Выполнение',description:'Описание',agendaOrder:'Порядок в «Сегодня»',gptUrl:'Ссылка на GPT',claudeUrl:'Ссылка на Claude',dueDate:'Срок',labels:'Теги',parent:'Головная задача',pinned:'Закрепление',location:'Облако',deleted:'Удаление',archived:'Архив',color:'Цвет',category:'Тема',entity:'Задача или облако',order:'Порядок',children:'Содержимое облака'};
function label(entity:Entity|undefined){return String(entity?.title||entity?.text||'Без названия');}
function setMerge(base:unknown[],local:unknown[],remote:unknown[]){return [...remote.filter(x=>!base.some(b=>equal(b,x))||local.some(l=>equal(l,x))),...local.filter(x=>!base.some(b=>equal(b,x))&&!remote.some(r=>equal(r,x)))];}
function reorder(reference:string[],ids:string[]){return reference.filter(id=>ids.includes(id));}
/** Keep concurrent insertions, placing them next to a surviving local anchor. */
export function mergeOrder(base:string[],local:string[],remote:string[],members:string[],choose:(b:unknown,l:unknown,r:unknown)=>unknown):string[]{
 const common=base.filter(x=>local.includes(x)&&remote.includes(x)&&members.includes(x));
 const b=reorder(base,common),l=reorder(local,common),r=reorder(remote,common);
 const reordered=!equal(l,b);let order=[...remote.filter(x=>members.includes(x))];
 if(reordered){
  const target=!equal(r,b)&&!equal(l,r)?choose(b,l,r) as string[]:l;
  const slots=order.map((id,i)=>target.includes(id)?i:-1).filter(i=>i>=0);
  slots.forEach((slot,i)=>{order[slot]=target[i]});
 }
 for(let i=0;i<local.length;i++){const id=local[i];if(!members.includes(id)||order.includes(id))continue;
  const next=local.slice(i+1).find(x=>order.includes(x));const previous=local.slice(0,i).reverse().find(x=>order.includes(x));
  order.splice(next?order.indexOf(next):previous?order.indexOf(previous)+1:order.length,0,id);
 }
 return [...order,...members.filter(id=>!order.includes(id))];
}
export function mergeBoards(base:Board,local:Board,remote:Board,choices:Choices={},optimistic=false):{data:Board;conflicts:MergeConflict[]}{
 const b=flatten(base),l=flatten(local),r=flatten(remote);const result=new Map(r.entities);const conflicts:MergeConflict[]=[];
 function decide(key:string,field:string,before:unknown,after:unknown,current:unknown,title:string){
  const id=JSON.stringify([key,field]);const choice=choices[id];
  if(!choice&&!optimistic)conflicts.push({key:id,title,field:fields[field]||field,base:before??null,local:after??null,remote:current??null});
  return choice==='remote'?current:after;
 }
 // A cloud deleted remotely must not silently absorb offline work. Restore only by explicit choice.
 const blocked=new Set<string>();
 // Physical removal is rare (the UI uses the trash flag), but old clients may do it.
 for(const old of base.notes){if(local.notes.some(n=>n.id===old.id))continue;const now=remote.notes.find(n=>n.id===old.id);
  if(now&&!equal(old,now)){
   const picked=decide('n:'+old.id,'entity',old,undefined,now,old.title);
   if(equal(picked,now))blocked.add(old.id);
  }
 }
 for(const note of local.notes){const old=base.notes.find(n=>n.id===note.id),now=remote.notes.find(n=>n.id===note.id);
  if(old&&!old.deleted&&(!now||now.deleted)&&!equal(note,old)&&!note.deleted){
   const picked=decide('n:'+note.id,'entity',old,note,now,note.title);
   if(equal(picked,now)){blocked.add(note.id);continue;}
   result.set('n:'+note.id,{...l.entities.get('n:'+note.id)!,deleted:false});
   // If physically removed, restore unchanged children too; they remain available to the user.
   if(!now)for(const task of note.tasks)result.set('t:'+task.id,l.entities.get('t:'+task.id)!);
  }
 }
 for(const key of new Set([...b.entities.keys(),...l.entities.keys()])){
  const before=b.entities.get(key),after=l.entities.get(key),current=r.entities.get(key);if(equal(before,after))continue;
  const noteId=key.startsWith('n:')?key.slice(2):String((after?.location as Entity|undefined)?.noteId||(before?.location as Entity|undefined)?.noteId);
  const previousNote=String((before?.location as Entity|undefined)?.noteId||'');
  if(blocked.has(noteId)||blocked.has(previousNote))continue;
  const title=label(after||before||current);
  if(!before||!after||!current){
   const next=equal(current,before)||equal(current,after)?after:decide(key,'entity',before,after,current,title);
   if(next)result.set(key,next as Entity);else result.delete(key);continue;
  }
  const next={...(result.get(key)||current)};
  for(const field of new Set([...Object.keys(before),...Object.keys(after)])){
   if(field==='id'||equal(before[field],after[field]))continue;
   let value=after[field];
   if(!equal(current[field],before[field])&&!equal(current[field],after[field])){
    if(field==='labels'&&Array.isArray(before[field])&&Array.isArray(after[field])&&Array.isArray(current[field]))value=setMerge(before[field],after[field],current[field]);
    else value=decide(key,field,before[field],after[field],current[field],title);
   }
   if(value===undefined)delete next[field];else next[field]=value;
  }
  // Deleting a cloud must not conceal a collaborator's new or edited tasks.
  if(key.startsWith('n:')&&after.deleted&&!before.deleted){
   const old=base.notes.find(n=>n.id===noteId)?.tasks||[],now=remote.notes.find(n=>n.id===noteId)?.tasks||[];
   if(!equal(old,now)){const choice=decide(key,'children',old,'В корзину',now,title);if(choice!=='В корзину')next.deleted=current.deleted;}
  }
  result.set(key,next);
 }
 const noteIds=[...result.keys()].filter(k=>k.startsWith('n:')).map(k=>k.slice(2));
 const order=mergeOrder(b.orders.get(BOARD_ORDER)||[],l.orders.get(BOARD_ORDER)||[],r.orders.get(BOARD_ORDER)||[],noteIds,(bv,lv,rv)=>decide('notes','order',bv,lv,rv,'Облака'));
 const notes=order.map(id=>{
  const members=[...result.entries()].filter(([k,e])=>k.startsWith('t:')&&(e.location as Entity)?.noteId===id);
  const tasksOrder=mergeOrder(b.orders.get(taskOrder(id))||[],l.orders.get(taskOrder(id))||[],r.orders.get(taskOrder(id))||[],members.map(([,e])=>String(e.id)),(bv,lv,rv)=>decide('o:'+id,'order',bv,lv,rv,label(result.get('n:'+id))));
  const tasks=tasksOrder.map(taskId=>{const {location,...task}=result.get('t:'+taskId)!;const {noteId:_,...extra}=location as Entity;return {...task,...extra} as Task});
  return {...result.get('n:'+id),tasks} as Note;
 });
 const data:Board={...remote,notes,categories:setMerge(base.categories,local.categories,remote.categories) as string[],labels:setMerge(base.labels||[],local.labels||[],remote.labels||[]) as string[]};
 // Imports are immutable receipts; never let an offline client erase newer ones.
 data.imports=[...(remote.imports||[]),...(local.imports||[]).filter(x=>!remote.imports?.some(y=>y.id===x.id))];
 return {data,conflicts};
}
export function assertBoardIntegrity(board:Board){
 const notes=new Set<string>(),tasks=new Map<string,Task>();
 for(const note of board.notes){if(notes.has(note.id))throw new Error('Повторяется идентификатор облака.');notes.add(note.id);
  if(note.id===FOCUS_NOTE_ID&&note.deleted)throw new Error('Нельзя удалить облако «Задачи».');
  for(const task of note.tasks){if(tasks.has(task.id))throw new Error('Повторяется идентификатор задачи.');tasks.set(task.id,task);}
 }
 for(const task of tasks.values()){const seen=new Set([task.id]);let parent=task.parent?.taskId;while(parent&&tasks.has(parent)){if(seen.has(parent))throw new Error('Головные задачи образуют замкнутую цепочку.');seen.add(parent);parent=tasks.get(parent)?.parent?.taskId;}}
}
export function noteEdit(base:Board,original:Note|null,note:Note):SyncOperation{
 const originalIds=new Set(original?.tasks.map(t=>t.id)||[]);
 // A remote move can place an original task in another cloud while this editor is open.
 // Restore its old location only in the comparison baseline, never duplicate its identity.
 const before={...base,notes:original?base.notes.map(n=>n.id===original.id?original:{...n,tasks:n.tasks.filter(t=>!originalIds.has(t.id))}):base.notes.filter(n=>n.id!==note.id)};
 if(original&&!before.notes.some(n=>n.id===original.id))before.notes=[original,...before.notes];
 return {id:crypto.randomUUID(),base:before,data:{...before,notes:original?before.notes.map(n=>n.id===note.id?note:n):[note,...before.notes]}};
}
