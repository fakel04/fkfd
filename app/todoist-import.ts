import { z } from 'zod';
import { boardSchema, ensureFocusBoard, type Board, type Note, type Task, type ImportReceipt } from './board-model.ts';

const id=z.string().min(1).max(100);
export const todoistImportSchema=z.object({
 importId:id,
 projects:z.array(z.object({id,name:z.string().min(1).max(300),description:z.string().max(50000).default(''),color:z.string().optional(),isFavorite:z.boolean().default(false),childOrder:z.number().default(0),sections:z.array(z.object({id,name:z.string().min(1).max(300),sectionOrder:z.number(),description:z.string().max(50000).optional()})).default([])})).max(500),
 tasks:z.array(z.object({id,content:z.string().min(1).max(10000),description:z.string().max(50000).default(''),projectId:id,sectionId:id.optional(),parentId:id.optional(),checked:z.boolean(),isDeleted:z.boolean().optional(),dueDate:z.string().optional(),deadlineDate:z.string().optional(),labels:z.array(z.string()).default([]),priority:z.string(),recurring:z.union([z.boolean(),z.string()]),duration:z.string().optional(),addedAt:z.string().optional()})).max(20000)
});
export type TodoistImport=z.infer<typeof todoistImportSchema>;
const projectColor=(color?:string)=>color&&/red|orange|salmon/.test(color)?'peach':color&&/green|teal/.test(color)?'sage':color&&/blue/.test(color)?'blue':color&&/yellow/.test(color)?'yellow':'lavender';

// A merge never overwrites local edits or restores tasks removed after an earlier import.
export function mergeTodoist(existing:Board,input:TodoistImport,now:string):{board:Board;receipt:ImportReceipt;alreadyImported:boolean}{
 const prior=existing.imports?.find(item=>item.id===input.importId);
 if(prior)return {board:existing,receipt:prior,alreadyImported:true};
 const data=todoistImportSchema.parse(input);
 const board=structuredClone(ensureFocusBoard(existing));
 const seen=new Set([...(board.imports||[]).flatMap(i=>i.taskIds),...board.notes.flatMap(n=>n.tasks.flatMap(t=>t.todoist?[t.todoist.id]:t.id.startsWith('todoist:')?[t.id.slice(8)]:[]))]);
 const active=data.tasks.filter(t=>!t.checked&&!t.isDeleted);
 if(new Set(active.map(t=>t.id)).size!==active.length)throw new Error('Повторяющиеся ID в импорте');
 const taskMap=new Map(active.map(t=>[t.id,t]));
 const projects=new Map(data.projects.map(p=>[p.id,p]));
 for(const task of active){if(!projects.has(task.projectId))throw new Error('Не найден проект задачи');if(task.parentId&&!taskMap.has(task.parentId))throw new Error('Не найдена родительская задача');}
 function sectionOf(task:typeof active[number],trail=new Set<string>()):string|undefined{
  if(trail.has(task.id))throw new Error('Цикл подзадач');trail.add(task.id);
  return task.sectionId||(task.parentId?sectionOf(taskMap.get(task.parentId)!,trail):undefined);
 }
 let noteCount=0,taskCount=0;
 for(const project of [...data.projects].sort((a,b)=>a.childOrder-b.childOrder)){
  const all=active.filter(t=>t.projectId===project.id);
  if(!all.length)continue;
  const groups=[{id:undefined as string|undefined,name:'',description:''},...project.sections.sort((a,b)=>a.sectionOrder-b.sectionOrder)];
  for(const task of all){const section=sectionOf(task);if(section&&!project.sections.some(s=>s.id===section))throw new Error('Не найден раздел задачи');}
  for(const group of groups){
   const members=all.filter(t=>sectionOf(t)===group.id);
   if(!members.length)continue;
   const pending=members.filter(t=>!seen.has(t.id));if(!pending.length)continue;
   const noteId='todoist:'+project.id+(group.id?':'+group.id:'');
   let note=board.notes.find(n=>n.id===noteId);
   if(!note){
    const category=project.sections.length?project.name.slice(0,60):board.categories.includes(project.name)?project.name:'';
    if(category&&!board.categories.includes(category))board.categories.push(category);
    note={id:noteId,title:(group.id?group.name:project.name).slice(0,300),text:group.id?(group.description||''):project.description,tasks:[],color:projectColor(project.color),category,pinned:false,archived:false,deleted:false,created:now,todoist:{projectId:project.id,projectName:project.name,sectionId:group.id,sectionName:group.id?group.name:undefined}};
    board.notes.push(note);noteCount++;
   }
   const ordered:typeof members=[];const visited=new Set<string>();
   function add(task:typeof members[number]){if(visited.has(task.id))return;visited.add(task.id);ordered.push(task);members.filter(t=>t.parentId===task.id).forEach(add)}
   members.filter(t=>!t.parentId||!members.some(p=>p.id===t.parentId)).forEach(add);members.forEach(add);
   for(const t of ordered){if(seen.has(t.id))continue;
    const task:Task={id:'todoist:'+t.id,text:t.content,done:t.checked,todoist:{id:t.id,projectId:t.projectId,sectionId:sectionOf(t),parentId:t.parentId,parentTitle:t.parentId?taskMap.get(t.parentId)?.content:undefined,description:t.description,dueDate:t.dueDate,deadlineDate:t.deadlineDate,labels:t.labels,priority:t.priority,recurring:t.recurring,duration:t.duration,addedAt:t.addedAt}};
    note.tasks.push(task);seen.add(t.id);taskCount++;
   }
  }
 }
 const receipt={id:data.importId,at:now,taskCount,noteCount,taskIds:active.map(t=>t.id)};
 board.imports=[...(board.imports||[]),receipt];
 return {board:boardSchema.parse(board),receipt,alreadyImported:false};
}
