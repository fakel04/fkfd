import type {Task} from './board-model.ts';

export type TaskBreak = {value:string;start:number;end:number};

const normalizeBreaks=(value:string)=>value.replace(/\r\n?/g,'\n');
export const hasTaskBreak=(value:string)=>/[\r\n]/.test(value);

function continuation(task:Task,text:string,createId:()=>string):Task{
 // A new checklist item has no source cloud: it was created here, not moved here.
 return {id:createId(),text,done:false,...(task.pinned?{pinned:true}:{}),
  ...(task.focused?{focused:true}:{})};
}

/** Recover literal newlines left by older mobile input without losing empty items. */
export function expandTaskLines(tasks:Task[],createId:()=>string=()=>crypto.randomUUID()):Task[]{
 const count=tasks.reduce((total,task)=>total+normalizeBreaks(task.text).split('\n').length,0);
 if(count>500)return tasks;
 return tasks.flatMap(task=>normalizeBreaks(task.text).split('\n').map((text,index)=>
  index===0?{...task,text}:{...continuation(task,text,createId),done:task.done}));
}

/** Empty checklist items are data, not disposable whitespace. */
export const prepareTaskList = (tasks:Task[]):Task[] => expandTaskLines(tasks).map(task=>({...task,text:task.text.trim()}));

export function splitTaskLines(tasks:Task[],taskId:string,value:string,caret:number,createId:()=>string){
 const index=tasks.findIndex(task=>task.id===taskId);
 const text=normalizeBreaks(value),parts=text.split('\n');
 if(index<0||parts.length<2||tasks.length+parts.length-1>500)return null;
 const task=tasks[index];
 const rows=parts.map((part,i)=>i===0?{...task,text:part}:continuation(task,part,createId));
 const prefix=normalizeBreaks(value.slice(0,Math.max(0,Math.min(caret,value.length)))).split('\n');
 const focusIndex=Math.min(prefix.length-1,rows.length-1);
 return {tasks:[...tasks.slice(0,index),...rows,...tasks.slice(index+1)],focusId:rows[focusIndex].id,focusOffset:prefix.at(-1)!.length};
}

export function splitTask(tasks:Task[],taskId:string,edit:TaskBreak,createId:()=>string){
 const start=Math.max(0,Math.min(edit.start,edit.value.length));
 const end=Math.max(start,Math.min(edit.end,edit.value.length));
 return splitTaskLines(tasks,taskId,edit.value.slice(0,start)+'\n'+edit.value.slice(end),start+1,createId);
}
