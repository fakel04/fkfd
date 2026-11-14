import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { boardSchema } from '../../board-model';
import {canWrite} from '../../access-model';
import {AccessError} from '../../access-store';
import {requireSession,apiError,checkOrigin} from '../../server-access';
import {readBoardSince,writeSharedBoard} from '../../board-store';
export async function GET(request:Request) {
 try{
  const session=await requireSession();
  const known=request.headers.get('X-Oblaka-Revision');
  const sameAccount=request.headers.get('X-Oblaka-Account')===JSON.stringify([session.userId,session.boardId]);
  const revision=sameAccount&&known!==null&&/^\d+$/.test(known)?Number(known):undefined;
  const board=await readBoardSince(env.DB!,session,revision);
  return Response.json({userId:session.userId,session,...board},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return apiError(error)}
}
export async function PUT(request:Request) {
 try{
  const session=await requireSession();checkOrigin(request);
  if(!canWrite(session.role))throw new AccessError('Изменять доску нельзя.');
  if(Number(request.headers.get('content-length')||0)>3000000)throw new AccessError('Слишком большой запрос.',413);
  const raw=await request.text();if(raw.length>3000000)throw new AccessError('Слишком большой запрос.',413);
  let body;try{body=z.object({revision:z.number().int().min(0),data:boardSchema}).parse(JSON.parse(raw))}catch{throw new AccessError('Некорректная доска.',400)}
  const revision=await writeSharedBoard(env.DB!,session,JSON.stringify(body.data),body.revision);
  return Response.json({revision},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return apiError(error)}
}
