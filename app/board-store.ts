import {canWrite,type Session} from './access-model.ts';
import {AccessError} from './access-store.ts';
export async function readBoardSince(db:D1Database,session:Session,knownRevision?:number){
 if(knownRevision!==undefined){
  const row=await db.prepare('SELECT revision FROM boards WHERE user_id = ?').bind(session.boardId).first<{revision:number}>();
  if(row&&row.revision===knownRevision)return {unchanged:true,revision:row.revision,data:undefined};
 }
 return readSharedBoard(db,session);
}
export async function readSharedBoard(db:D1Database,session:Session){
 const row=await db.prepare('SELECT data, revision FROM boards WHERE user_id = ?').bind(session.boardId).first<{data:string;revision:number}>();
 return{data:row?JSON.parse(row.data):null,revision:row?.revision??0};
}
export async function writeSharedBoard(db:D1Database,session:Session,value:string,revision:number){
 if(!canWrite(session.role))throw new AccessError('У вас доступ только для просмотра.');
 const now=new Date().toISOString();
 const result=revision===0
  ? await db.prepare('INSERT INTO boards (user_id, data, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO NOTHING').bind(session.boardId,value,now).run()
  : await db.prepare('UPDATE boards SET data = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?').bind(value,now,session.boardId,revision).run();
 if(!result.meta.changes)throw new AccessError('Доска изменена другим участником. Обновите её перед сохранением.',409);
 return revision+1;
}
