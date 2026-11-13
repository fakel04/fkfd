import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {boardSchema} from '../../../board-model';
import {AccessError} from '../../../access-store';
import {requireSession,checkOrigin,apiError} from '../../../server-access';
import {syncBoard,syncCompactBoard} from '../../../sync-store';
import {type Delta} from '../../../board-delta';
import {decodeSyncBody} from '../../../sync-wire';
import {equal} from '../../../board-merge';
export async function POST(request:Request){
 try{
  const session=await requireSession();checkOrigin(request);
  let body;try{body=z.object({userId:z.string(),boardId:z.string(),compactResponse:z.boolean().optional(),operation:z.union([
   z.object({id:z.string().uuid(),base:boardSchema,data:boardSchema}).strict(),
   z.object({id:z.string().uuid(),revision:z.number().int().min(1),delta:z.array(z.unknown()).min(2).max(3)}).strict(),
  ])}).strict().parse(await decodeSyncBody(request))}catch{throw new AccessError('Некорректное изменение доски.',400)}
  if(body.userId!==session.userId||body.boardId!==session.boardId)throw new AccessError('Аккаунт изменён. Откройте доску заново.',403);
  const operation=body.operation;
  if('revision' in operation){
   const result=await syncCompactBoard(env.DB!,session,{...operation,delta:operation.delta as Delta});
   if('acknowledged' in result&&result.acknowledged)return Response.json({session,revision:result.revision,acknowledged:true,operationId:operation.id},{headers:{'Cache-Control':'no-store'}});
   return Response.json({...result,session},{headers:{'Cache-Control':'no-store'}});
  }
  const result=await syncBoard(env.DB!,session,operation);
  if(body.compactResponse&&!result.conflicts.length&&equal(operation.data,result.data))return Response.json({session,revision:result.revision,acknowledged:true,operationId:operation.id},{headers:{'Cache-Control':'no-store'}});
  return Response.json({...result,session},{status:result.conflicts.length?409:200,headers:{'Cache-Control':'no-store'}});
 }catch(error){return apiError(error)}
}
