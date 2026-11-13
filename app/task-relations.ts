import type {Board,Task,TaskParent} from './board-model.ts';

function taskIndex(board:Board){
 const tasks=board.notes.flatMap(note=>note.tasks);
 return {byId:new Map(tasks.map(task=>[task.id,task])),byTodoist:new Map(tasks.filter(task=>task.todoist).map(task=>[task.todoist!.id,task]))};
}
function resolveParent(task:Task,index:ReturnType<typeof taskIndex>):TaskParent|null{
 if(task.parent!==undefined){
  if(!task.parent)return null;
  return {...task.parent,title:index.byId.get(task.parent.taskId)?.text||task.parent.title};
 }
 if(!task.todoist?.parentId)return null;
 const parent=index.byTodoist.get(task.todoist.parentId);
 return {taskId:parent?.id||'todoist:'+task.todoist.parentId,title:parent?.text||task.todoist.parentTitle||'Головная задача'};
}
export function createParentResolver(board:Board){
 const index=taskIndex(board);
 return (task:Task)=>resolveParent(task,index);
}
export const taskParent=(board:Board,task:Task)=>createParentResolver(board)(task);

function safeParent(index:ReturnType<typeof taskIndex>,taskId:string,parentId:string):boolean{
 if(!index.byId.has(taskId)||!index.byId.has(parentId))return false;
 const seen=new Set([taskId]);let cursor:string|undefined=parentId;
 while(cursor){
  if(seen.has(cursor))return false;seen.add(cursor);
  const task=index.byId.get(cursor);cursor=task?resolveParent(task,index)?.taskId:undefined;
 }
 return true;
}
export function canChooseParent(board:Board,taskId:string,parentId:string):boolean{
 const note=board.notes.find(note=>note.tasks.some(task=>task.id===parentId));
 return !!note&&!note.deleted&&!note.archived&&safeParent(taskIndex(board),taskId,parentId);
}
export function parentChoices(board:Board,taskId:string){
 const index=taskIndex(board);
 return board.notes.filter(note=>!note.archived&&!note.deleted).flatMap(note=>note.tasks
  .filter(task=>!!task.text.trim()&&safeParent(index,taskId,task.id))
  .map(task=>({taskId:task.id,title:task.text,cloud:note.title||'Без названия',done:task.done})));
}
