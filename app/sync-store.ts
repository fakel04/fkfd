import {type Session,canWrite} from './access-model.ts';
import {AccessError} from './access-store.ts';
import {readSharedBoard} from './board-store.ts';
import {boardSchema,type Board} from './board-model.ts';
import {mergeBoards,assertBoardIntegrity,type SyncOperation} from './board-merge.ts';
import {applyDifference,type CompactOperation} from './board-delta.ts';

const digest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
async function replay(db:D1Database,session:Session,id:string,hash:string){
 const row=await db.prepare('SELECT actor_id, payload_hash FROM board_operations WHERE board_id = ? AND operation_id = ?').bind(session.boardId,id).first<{actor_id:string;payload_hash:string}>();
 if(!row)return null;
 if(row.actor_id!==session.userId||row.payload_hash!==hash)throw new AccessError('Идентификатор изменения уже использован.',400);
 return {...await readSharedBoard(db,session),conflicts:[]};
}
async function commit(db:D1Database,session:Session,id:string,hash:string,data:Board,previousRevision:number){
 const now=new Date().toISOString(),revision=previousRevision+1;
 const results=await db.batch([
  db.prepare('INSERT INTO board_operations (board_id,operation_id,actor_id,payload_hash,result_revision,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM boards WHERE user_id = ? AND revision = ?) ON CONFLICT(board_id,operation_id) DO NOTHING').bind(session.boardId,id,session.userId,hash,revision,now,session.boardId,previousRevision),
  db.prepare('UPDATE boards SET data = ?, revision = ?, updated_at = ? WHERE user_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM board_operations WHERE board_id = ? AND operation_id = ? AND actor_id = ? AND payload_hash = ? AND result_revision = ?)').bind(JSON.stringify(data),revision,now,session.boardId,previousRevision,session.boardId,id,session.userId,hash,revision),
 ]);
 return results[1].meta.changes?{data,revision,conflicts:[]}:null;
}

// The fast path sends only changed fields. A revision mismatch performs NO write;
// the client keeps its original base and uses the existing three-way merge protocol.
export async function syncCompactBoard(db:D1Database,session:Session,operation:CompactOperation){
 if(!canWrite(session.role))throw new AccessError('У вас доступ только для просмотра.');
 const hash='delta-v1:'+await digest(operation);
 const done=await replay(db,session,operation.id,hash);if(done)return done;
 const current=await readSharedBoard(db,session);
 if(current.data&&current.revision===operation.revision){
  let data:Board;
  try{data=boardSchema.parse(applyDifference(current.data,operation.delta));assertBoardIntegrity(data)}catch{throw new AccessError('Некорректное изменение доски. Локальная копия сохранена.',422)}
  const saved=await commit(db,session,operation.id,hash,data,current.revision);
  if(saved)return {...saved,acknowledged:true};
 }
 // A competing retry may have committed between the receipt lookup and the CAS.
 const committed=await replay(db,session,operation.id,hash);if(committed)return committed;
 return {...await readSharedBoard(db,session),conflicts:[],rebase:true};
}

export async function syncBoard(db:D1Database,session:Session,operation:SyncOperation){
 if(!canWrite(session.role))throw new AccessError('У вас доступ только для просмотра.');
 assertBoardIntegrity(operation.base);assertBoardIntegrity(operation.data);
 const hash=await digest(operation);
 const existing=await replay(db,session,operation.id,hash);if(existing)return existing;
 await db.prepare('INSERT INTO boards (user_id,data,revision,updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(user_id) DO NOTHING').bind(session.boardId,JSON.stringify({notes:[],categories:[]}),new Date().toISOString()).run();
 for(let attempt=0;attempt<5;attempt++){
  const done=await replay(db,session,operation.id,hash);if(done)return done;
  const current=await readSharedBoard(db,session);
  const merged=mergeBoards(operation.base,operation.data,current.data as Board);
  if(merged.conflicts.length)return {...current,conflicts:merged.conflicts};
  let data:Board;try{data=boardSchema.parse(merged.data);assertBoardIntegrity(data)}catch{throw new AccessError('Изменения несовместимы: проверьте головные задачи и размер облаков. Локальная копия сохранена.',422)}
  const saved=await commit(db,session,operation.id,hash,data,current.revision);if(saved)return saved;
 }
 throw new AccessError('Доска сейчас обновляется. Повторим синхронизацию.',503);
}
