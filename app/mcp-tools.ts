import {z} from 'zod';
import {createParentResolver} from './task-relations.ts';
import {taskLabels,taskDueDate,taskDescription,type Board,type Note,type Task} from './board-model.ts';

const scopeSchema=z.enum(['active','archived','deleted','all']).default('active');
const pageSchema={offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(100).default(50)};
const listInput=z.object({...pageSchema,scope:scopeSchema,query:z.string().max(300).optional()}).strict();
const cloudInput=z.object({...pageSchema,cloud_id:z.string().min(1).max(100),include_completed:z.boolean().default(true)}).strict();
const searchInput=z.object({...pageSchema,query:z.string().trim().min(1).max(300),cloud_id:z.string().min(1).max(100).optional(),scope:scopeSchema,include_completed:z.boolean().default(false)}).strict();
const pagination={offset:{type:'integer',minimum:0,default:0},limit:{type:'integer',minimum:1,maximum:100,default:50}};
const scope={type:'string',enum:['active','archived','deleted','all'],default:'active',description:'По умолчанию только активные облака. Архив и корзина — только по явному запросу.'};
const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
export const boardTools=[
 {name:'list_clouds',description:'Прочитать актуальный список облаков общей доски «Облака — задачи и заметки»: названия, категории, число задач. Это данные сайта, а не живая синхронизация с Todoist. Для всех результатов продолжайте с next_offset; детали облака читайте через get_cloud. Требуется выданный на доске доступ.',inputSchema:{type:'object',properties:{...pagination,scope,query:{type:'string',maxLength:300,description:'Поиск по названию, категории или тексту облака.'}},additionalProperties:false},annotations},
 {name:'get_cloud',description:'Прочитать текст облака и его задачи в текущем ручном порядке, включая выполненные, сроки, метки и сведения об исходном облаке. cloud_id берётся из list_clouds или search_tasks. Для полного списка продолжайте с next_offset. Только чтение.',inputSchema:{type:'object',properties:{...pagination,cloud_id:{type:'string',minLength:1,maxLength:100},include_completed:{type:'boolean',default:true}},required:['cloud_id'],additionalProperties:false},annotations},
 {name:'search_tasks',description:'Найти задачи в актуальной общей доске по тексту, описанию, названию облака, метке или исходному облаку. По умолчанию только невыполненные задачи в активных облаках. Возвращает краткие результаты; полный текст — get_cloud. Продолжайте с next_offset, пока он не null. Только чтение.',inputSchema:{type:'object',properties:{...pagination,query:{type:'string',minLength:1,maxLength:300},cloud_id:{type:'string',minLength:1,maxLength:100},scope,include_completed:{type:'boolean',default:false}},required:['query'],additionalProperties:false},annotations}
];
const normalize=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
function visible(note:Note,scope:string){return scope==='all'||(scope==='deleted'?note.deleted:scope==='archived'?note.archived&&!note.deleted:!note.deleted&&!note.archived)}
function summary(note:Note){return{id:note.id,title:note.title,text_excerpt:note.text.slice(0,500),text_truncated:note.text.length>500,category:note.category,pinned:note.pinned,archived:note.archived,deleted:note.deleted,focus:note.kind==='focus'||note.id==='__focus_tasks__',task_count:note.tasks.length,completed_count:note.tasks.filter(t=>t.done).length}}
function source(board:Board,task:Task){return task.origin?{id:task.origin.noteId,title:board.notes.find(n=>n.id===task.origin!.noteId)?.title||task.origin.title}:null}
function page<T>(items:T[],offset:number,limit:number){const values=items.slice(offset,offset+limit);return{items:values,total:items.length,offset,next_offset:offset+values.length<items.length?offset+values.length:null}}
function taskPresenter(board:Board){
 const parentOf=createParentResolver(board),byId=new Map(board.notes.flatMap(note=>note.tasks).map(task=>[task.id,task]));
 return (task:Task)=>{
 const parent=parentOf(task);
 const parentTodoistId=parent?(byId.get(parent.taskId)?.todoist?.id||(task.parent===undefined?task.todoist?.parentId:undefined)):undefined;
 const description=taskDescription(task);
 return {...task,description,parent,labels:taskLabels(task),dueDate:taskDueDate(task),todoist:task.todoist?{...task.todoist,description,parentId:parentTodoistId,parentTitle:parent?.title,labels:taskLabels(task),dueDate:taskDueDate(task)??undefined}:undefined};
}
}
export function readBoardTool(name:string,args:unknown,data:Board|null,revision:number){
 const board=data??{notes:[],categories:[]};const presentTask=taskPresenter(board);
 if(name==='list_clouds'){
  const input=listInput.parse(args);const query=normalize(input.query||'');
  const items=board.notes.filter(n=>visible(n,input.scope)&&(!query||normalize([n.title,n.text,n.category].join('\n')).includes(query))).map(summary);
  return{revision,scope:input.scope,...page(items,input.offset,input.limit)};
 }
 if(name==='get_cloud'){
  const input=cloudInput.parse(args);const note=board.notes.find(n=>n.id===input.cloud_id);if(!note)throw new Error('Облако не найдено. Обновите список облаков.');
  const tasks=note.tasks.map((task,position)=>({...presentTask(task),position,source_cloud:source(board,task)})).filter(t=>input.include_completed||!t.done);
  return{revision,cloud:{...summary(note),text:note.text,todoist:note.todoist},tasks:page(tasks,input.offset,input.limit)};
 }
 if(name==='search_tasks'){
  const input=searchInput.parse(args);const terms=normalize(input.query).split(/\s+/);const items=[];
  for(const note of board.notes){
   if(!visible(note,input.scope)||(input.cloud_id&&input.cloud_id!==note.id))continue;
   for(const [position,task] of note.tasks.entries()){
    if(task.done&&!input.include_completed)continue;
    const origin=source(board,task),current=presentTask(task);const haystack=normalize([task.text,current.description,current.parent?.title,note.title,note.category,origin?.title,...taskLabels(task)].join('\n'));
    if(!terms.every(term=>haystack.includes(term)))continue;
    items.push({id:task.id,cloud_id:note.id,cloud_title:note.title,position,text:task.text.slice(0,1000),text_truncated:task.text.length>1000,done:task.done,focused:!!task.focused,source_cloud:origin,description_excerpt:current.description.slice(0,500),due_date:taskDueDate(task),deadline_date:task.todoist?.deadlineDate,labels:taskLabels(task),parent_id:current.todoist?.parentId,parent_task_id:current.parent?.taskId,parent_title:current.parent?.title});
   }
  }
  return{revision,scope:input.scope,...page(items,input.offset,input.limit)};
 }
 throw new Error('Неизвестный инструмент.');
}
