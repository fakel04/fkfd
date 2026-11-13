import {type Session} from './access-model.ts';
import {AccessError} from './access-store.ts';
import {boardSchema,ensureFocusBoard,boardBytes,MAX_BOARD_BYTES,BOARD_TOO_LARGE,type Board} from './board-model.ts';
import {assertBoardIntegrity} from './board-merge.ts';

/** Parses a file from «Скачать копию доски». Extra keys such as `recovery` are dropped. */
export function parseBoardBackup(text:string):Board{
 let value:unknown;
 try{value=JSON.parse(text)}catch{throw new AccessError('Файл не похож на копию доски: это не JSON.',400)}
 const parsed=boardSchema.safeParse(value);
 if(!parsed.success)throw new AccessError('Файл не похож на копию доски «Облака».',400);
 const board=ensureFocusBoard(parsed.data);
 try{assertBoardIntegrity(board)}catch(error){throw new AccessError('Копия повреждена: '+(error as Error).message,400)}
 return board;
}

/** Owner-only: replaces the whole shared board. Other devices pick it up on their next sync. */
export async function replaceSharedBoard(db:D1Database,session:Session,board:Board){
 if(session.role!=='superadmin')throw new AccessError('Загрузить копию доски может только владелец.');
 const value=JSON.stringify(board);
 if(boardBytes(value)>MAX_BOARD_BYTES)throw new AccessError(BOARD_TOO_LARGE,413);
 for(let attempt=0;attempt<5;attempt++){
  const row=await db.prepare('SELECT revision FROM boards WHERE user_id = ?').bind(session.boardId).first<{revision:number}>();
  const now=new Date().toISOString();
  if(!row){
   const inserted=await db.prepare('INSERT INTO boards (user_id, data, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO NOTHING').bind(session.boardId,value,now).run();
   if(inserted.meta.changes)return 1;
   continue;
  }
  const updated=await db.prepare('UPDATE boards SET data = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?').bind(value,now,session.boardId,row.revision).run();
  if(updated.meta.changes)return row.revision+1;
 }
 throw new AccessError('Доска сейчас обновляется. Повторите загрузку.',503);
}
