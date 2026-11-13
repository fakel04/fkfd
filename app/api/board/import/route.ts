import {env} from 'cloudflare:workers';
import {AccessError} from '../../../access-store';
import {requireSession,checkOrigin,apiError} from '../../../server-access';
import {parseBoardBackup,replaceSharedBoard} from '../../../board-import';
export async function POST(request:Request){
 try{
  const session=await requireSession();checkOrigin(request);
  if(session.role!=='superadmin')throw new AccessError('Загрузить копию доски может только владелец.');
  if(Number(request.headers.get('content-length')||0)>8000000)throw new AccessError('Файл слишком большой.',413);
  const text=await request.text();if(text.length>8000000)throw new AccessError('Файл слишком большой.',413);
  const board=parseBoardBackup(text);
  const revision=await replaceSharedBoard(env.DB!,session,board);
  return Response.json({revision,notes:board.notes.length,tasks:board.notes.reduce((n,note)=>n+note.tasks.length,0)},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return apiError(error)}
}
