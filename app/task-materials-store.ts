import type {Session} from './access-model.ts';
import {AccessError} from './access-store.ts';
import {readBoardFor} from './board-store.ts';
import type {Note,Task} from './board-model.ts';
import {MAX_FILE_BYTES,MAX_TASK_MATERIALS,attachmentName,type MaterialInput,type FileMaterialInput,type TaskMaterial} from './task-materials-model.ts';

type MaterialRow={id:string;kind:TaskMaterial['kind'];text:string;title:string;source:TaskMaterial['source'];source_url:string;url:string;file_key:string|null;file_name:string|null;file_size:number|null;author_name:string;created_at:string;updated_at:string;revision:number};
function view(row:MaterialRow):TaskMaterial{return {id:row.id,kind:row.kind,text:row.text,title:row.title,source:row.source,sourceUrl:row.source_url,url:row.url,fileName:row.file_name,fileSize:row.file_size,authorName:row.author_name,createdAt:row.created_at,updatedAt:row.updated_at,revision:row.revision}}
export async function requireMaterialTask(db:D1Database,session:Session,taskId:string){
 const {data}=await readBoardFor(db,session);
 if(!data?.notes.some((note:Note)=>!note.deleted&&note.tasks.some((task:Task)=>task.id===taskId)))throw new AccessError('Дело недоступно или ещё не синхронизировано. Сохраните облако и повторите.',404);
}
async function rowFor(db:D1Database,session:Session,taskId:string,id:string){
 const row=await db.prepare('SELECT * FROM task_materials WHERE board_id = ? AND task_id = ? AND id = ?').bind(session.boardId,taskId,id).first<MaterialRow>();
 if(!row)throw new AccessError('Материал не найден.',404);return row;
}
export async function listMaterials(db:D1Database,session:Session,taskId:string){
 await requireMaterialTask(db,session,taskId);
 const rows=await db.prepare('SELECT * FROM task_materials WHERE board_id = ? AND task_id = ? ORDER BY created_at, id').bind(session.boardId,taskId).all<MaterialRow>();
 return rows.results.map(view);
}
async function checkRoom(db:D1Database,session:Session,taskId:string){
 const count=await db.prepare('SELECT COUNT(*) AS total FROM task_materials WHERE board_id = ? AND task_id = ?').bind(session.boardId,taskId).first<{total:number}>();
 if((count?.total??0)>=MAX_TASK_MATERIALS)throw new AccessError('В деле уже 200 материалов. Удалите ненужные перед добавлением.',413);
}
async function insert(db:D1Database,session:Session,taskId:string,input:MaterialInput|FileMaterialInput&{kind:'file';url:string},file?:{key:string;name:string;size:number}){
 const id=crypto.randomUUID(),now=new Date().toISOString();
 await db.prepare('INSERT INTO task_materials (id, board_id, task_id, kind, text, title, source, source_url, url, file_key, file_name, file_size, author_id, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .bind(id,session.boardId,taskId,input.kind,input.text,input.title,input.source,input.sourceUrl,input.url,file?.key??null,file?.name??null,file?.size??null,session.userId,session.name||session.email,now,now).run();
 return view(await rowFor(db,session,taskId,id));
}
export async function createMaterial(db:D1Database,session:Session,taskId:string,input:MaterialInput){
 await requireMaterialTask(db,session,taskId);await checkRoom(db,session,taskId);return insert(db,session,taskId,input);
}
export async function uploadMaterial(db:D1Database,bucket:R2Bucket|undefined,session:Session,taskId:string,file:File,metadata:FileMaterialInput={text:'',title:'',source:'other',sourceUrl:''}){
 await requireMaterialTask(db,session,taskId);await checkRoom(db,session,taskId);
 if(!bucket)throw new AccessError('Хранилище файлов ещё не подключено. Комментарии и ссылки уже доступны.',503);
 if(!file.size||file.size>MAX_FILE_BYTES)throw new AccessError('Выберите непустой файл размером до 10 МБ.',413);
 const name=attachmentName(file.name),key='task-materials/'+crypto.randomUUID();
 await bucket.put(key,file.stream(),{httpMetadata:{contentType:'application/octet-stream'}});
 try{return await insert(db,session,taskId,{...metadata,kind:'file',title:metadata.title||name,url:''},{key,name,size:file.size})}
 catch(error){await bucket.delete(key);throw error}
}
export async function updateMaterial(db:D1Database,session:Session,taskId:string,id:string,revision:number,input:MaterialInput){
 await requireMaterialTask(db,session,taskId);const row=await rowFor(db,session,taskId,id);
 if(row.kind==='file')throw new AccessError('Для замены файла удалите вложение и загрузите новое.',400);
 const result=await db.prepare('UPDATE task_materials SET kind = ?, text = ?, title = ?, source = ?, source_url = ?, url = ?, updated_at = ?, revision = revision + 1 WHERE board_id = ? AND task_id = ? AND id = ? AND revision = ?')
  .bind(input.kind,input.text,input.title,input.source,input.sourceUrl,input.url,new Date().toISOString(),session.boardId,taskId,id,revision).run();
 if(!result.meta.changes)throw new AccessError('Запись изменена на другом устройстве. Обновите список перед сохранением.',409);
 return view(await rowFor(db,session,taskId,id));
}
export async function deleteMaterial(db:D1Database,bucket:R2Bucket|undefined,session:Session,taskId:string,id:string,revision:number){
 await requireMaterialTask(db,session,taskId);const row=await rowFor(db,session,taskId,id);
 if(row.revision!==revision)throw new AccessError('Запись изменена на другом устройстве. Обновите список.',409);
 if(row.file_key){if(!bucket)throw new AccessError('Хранилище файлов недоступно. Повторите удаление позже.',503);await bucket.delete(row.file_key)}
 const result=await db.prepare('DELETE FROM task_materials WHERE board_id = ? AND task_id = ? AND id = ? AND revision = ?').bind(session.boardId,taskId,id,revision).run();
 if(!result.meta.changes)throw new AccessError('Запись уже изменена. Обновите список.',409);
}
export async function downloadMaterial(db:D1Database,bucket:R2Bucket|undefined,session:Session,taskId:string,id:string){
 await requireMaterialTask(db,session,taskId);const row=await rowFor(db,session,taskId,id);
 if(!row.file_key||!bucket)throw new AccessError('Файл недоступен.',404);
 const object=await bucket.get(row.file_key);if(!object)throw new AccessError('Файл не найден.',404);
 return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(attachmentName(row.file_name||'Вложение')).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16)), 'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
}
