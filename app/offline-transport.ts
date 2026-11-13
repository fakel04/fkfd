import type {Snapshot,TransportOptions} from './offline-controller.ts';
import {ConnectionError,SyncError} from './sync-errors.ts';
import {accountKey} from './offline-storage.ts';
import {difference} from './board-delta.ts';
import {encodeSyncBody} from './sync-wire.ts';
import type {SyncOperation} from './board-merge.ts';
import type {Session} from './access-model.ts';
import type {Board} from './board-model.ts';

type ResponseReference={data:Board;session:Session;revision?:number;operationId?:string};
export async function readSnapshot(options:TransportOptions={}){
 const known=options.known;
 return requestSnapshot('/api/board',{headers:known?{'X-Oblaka-Revision':String(known.revision),'X-Oblaka-Account':accountKey(known.session)}:{}},options,known);
}
export async function sendSnapshot(operation:SyncOperation,session:Session,options:TransportOptions={}){
 const wire=options.wireRevision===undefined?operation:{id:operation.id,revision:options.wireRevision,delta:difference(operation.base,operation.data)};
 const encoded=await encodeSyncBody({operation:wire,userId:session.userId,boardId:session.boardId,compactResponse:true});
 return requestSnapshot('/api/board/sync',{method:'POST',...encoded},options,{data:operation.data,session,operationId:operation.id});
}

export async function requestSnapshot(path:string,init:RequestInit={},options:TransportOptions={},reference?:ResponseReference):Promise<Snapshot>{
 // Explicit retry probes the server even if iOS still reports its old offline state.
 if(!options.forceNetwork&&typeof navigator!=='undefined'&&navigator.onLine===false)
  throw new ConnectionError('offline','Нет подключения к интернету. Включите сеть и повторите попытку.');
 const abort=new AbortController();let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;abort.abort()},20000);
 try{
  const response=await fetch(path,{...init,cache:'no-store',redirect:'manual',signal:abort.signal});
  if(response.type==='opaqueredirect'||response.status===401||response.status===403)
   throw new SyncError('Войдите снова. Локальные правки сохранены для вашего аккаунта.',401);
  // A server outage may return HTML. It is not an authentication failure.
  if(response.status>=500)throw new SyncError(`Сервер временно недоступен (ошибка ${response.status}). Повторите попытку позже.`,response.status);
  if(!response.headers.get('content-type')?.includes('application/json')){
   if(!response.ok)throw new SyncError(`Сервер отклонил запрос (ошибка ${response.status}).`,response.status);
   throw new SyncError('Для доступа к доске нужно войти снова.',401);
  }
  let body:Snapshot&{error?:string;unchanged?:boolean;acknowledged?:boolean;operationId?:string};
  try{body=await response.json()}catch(error){if(timedOut)throw error;throw new SyncError('Сервер вернул некорректный ответ. Повторите попытку.',502)}
  if(!response.ok&&!(response.status===409&&Array.isArray(body?.conflicts)))
   throw new SyncError(body?.error||`Не удалось синхронизировать (ошибка ${response.status}).`,response.status);
  if(body?.unchanged||body?.acknowledged){
   if(!reference||!body.session||accountKey(body.session)!==accountKey(reference.session)
    ||(body.unchanged&&body.revision!==reference.revision)
    ||(body.acknowledged&&body.operationId!==reference.operationId))throw new SyncError('Ответ не соответствует сохранённой версии доски. Повторите попытку.',502);
   body={...body,data:reference.data};
  }
  if(!body?.session?.userId||!body.session.boardId||!Number.isFinite(body.revision)||!(body.data===null||Array.isArray(body.data?.notes)))
   throw new SyncError('Сервер вернул неполные данные. Повторите попытку.',502);
  return body;
 }catch(error){
  if(timedOut)throw new ConnectionError('timeout','Сервер не ответил вовремя. Нажмите «Повторить».');
  if(error instanceof SyncError)throw error;
  throw new ConnectionError('network','Не удалось связаться с сервером. Проверьте интернет и нажмите «Повторить».');
 }finally{clearTimeout(timer)}
}
