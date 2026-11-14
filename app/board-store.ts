import {seesAllClouds,type Session} from './access-model.ts';
import {AccessError,cloudScope} from './access-store.ts';
import {filterBoard} from './board-scope.ts';
import {boardBytes,MAX_BOARD_BYTES,BOARD_TOO_LARGE} from './board-model.ts';
export async function readBoardSince(db:D1Database,session:Session,knownRevision?:number){
 const scope=await cloudScope(db,session);
 // A member's view also changes when access changes, which does not bump the revision.
 if(scope)return readBoardFor(db,session,scope);
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
/** The board as this session may see it: members get only their clouds. */
export async function readBoardFor(db:D1Database,session:Session,scope?:ReadonlySet<string>|null){
 const snapshot=await readSharedBoard(db,session);const visible=scope===undefined?await cloudScope(db,session):scope;
 return {...snapshot,data:snapshot.data&&filterBoard(snapshot.data,visible)};
}
/** Legacy whole-board write; it cannot be limited to some clouds, so only admins may use it. */
export async function writeSharedBoard(db:D1Database,session:Session,value:string,revision:number){
 if(!seesAllClouds(session.role))throw new AccessError('Сохраните изменения через синхронизацию.');
 if(boardBytes(value)>MAX_BOARD_BYTES)throw new AccessError(BOARD_TOO_LARGE,413);
 const now=new Date().toISOString();
 const result=revision===0
  ? await db.prepare('INSERT INTO boards (user_id, data, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO NOTHING').bind(session.boardId,value,now).run()
  : await db.prepare('UPDATE boards SET data = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?').bind(value,now,session.boardId,revision).run();
 if(!result.meta.changes)throw new AccessError('Доска изменена другим участником. Обновите её перед сохранением.',409);
 return revision+1;
}
