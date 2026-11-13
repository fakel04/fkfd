import {canWrite,type Session} from './access-model.ts';
import {ensureFocusBoard,boardBytes,MAX_BOARD_BYTES,type Board} from './board-model.ts';
import {equal,mergeBoards,type SyncOperation,type MergeConflict,type Choices} from './board-merge.ts';
import {accountKey,type OfflineRecord,type OfflineStorage,type Draft} from './offline-storage.ts';
import {ConnectionError,SyncError} from './sync-errors.ts';
export {ConnectionError,SyncError} from './sync-errors.ts';

export type Snapshot={data:Board;revision:number;session:Session;conflicts?:MergeConflict[];rebase?:boolean};
export type TransportOptions={forceNetwork?:boolean;known?:Snapshot;wireRevision?:number};
export type Transport={compact?:boolean;read:(options?:TransportOptions)=>Promise<Snapshot>;send:(operation:SyncOperation,session:Session,options?:TransportOptions)=>Promise<Snapshot>};
export type OfflineState={board:Board;session:Session|null;ready:boolean;offline:boolean;syncing:boolean;status:string;error:string;conflicts:MergeConflict[];pending:number;drafts:Draft[];legacy?:Board;storageFailed:boolean;localSaving:number;tooLarge:boolean};
const empty=():Board=>({notes:[],categories:[]});
export function materialize(record:OfflineRecord){return record.queue.reduce((b,{operation:o})=>mergeBoards(o.base,o.data,b,{},true).data,record.base)}
export class OfflineController{
 state:OfflineState={board:empty(),session:null,ready:false,offline:false,syncing:false,status:'Загрузка…',error:'',conflicts:[],pending:0,drafts:[],storageFailed:false,localSaving:0,tooLarge:false};
 private key='';private listeners=new Set<()=>void>();private busy=false;private syncWaiters:(()=>void)[]=[];private work:Promise<unknown>=Promise.resolve();private waiting:SyncOperation[]=[];private timer:ReturnType<typeof setTimeout>|undefined;private stopped=false;
 private restoring:Promise<void>|undefined;
 private locked=false;private generation=0;
 private retryRequested=false;
 private failures=0;private nextAttemptAt=0;
 constructor(privateStore:OfflineStorage,transport:Transport,initial:()=>Board){this.store=privateStore;this.transport=transport;this.initial=initial}
 private store:OfflineStorage;private transport:Transport;private initial:()=>Board;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn)}};
 private emit(patch:Partial<OfflineState>){this.state={...this.state,...patch};for(const f of this.listeners)f()}
 private apply(record:OfflineRecord){
  if(this.locked)return;
  const board=this.waiting.reduce((b,o)=>mergeBoards(o.base,o.data,b,{},true).data,materialize(record));
  this.emit({board,session:record.session,ready:record.allowed,pending:record.queue.length+this.waiting.length,drafts:record.drafts,legacy:record.legacy});
 }
 private persist(fn:()=>Promise<unknown>){
  this.emit({localSaving:this.state.localSaving+1});
  const next=this.work.then(fn).finally(()=>this.emit({localSaving:Math.max(0,this.state.localSaving-1)}));this.work=next.catch(error=>{this.emit({storageFailed:true,status:'Не сохранено на устройстве',error:'Не удалось записать изменения на устройство. Не закрывайте страницу; скачайте копию. '+(error instanceof Error?error.message:'')})});return next;
 }
 private status(){if(this.state.storageFailed||this.state.error||this.state.conflicts.length||this.state.syncing)return;
  this.emit({status:this.state.offline?'Офлайн · сохранено на устройстве':this.state.pending?'Сохранено на устройстве · ожидает отправки':'Все изменения сохранены'});
 }
 async start(){
  this.stopped=false;
  // Local data must be visible before any network/authentication request settles.
  // Only the last explicitly allowed account is eligible for offline reopening.
  this.restoring??=(async()=>{
   try{
    const cached=await this.store.active();
    if(!this.stopped&&!this.locked&&cached?.allowed){
     this.key=cached.key;
     this.emit({offline:true,status:'Сохранено на устройстве · проверяем связь…'});
     this.apply(cached);
    }
   }catch{
    // Online loading can still recover a transient IndexedDB read failure.
   }
  })();
  await this.restoring;
  await this.sync(true);
 }
 stop(){this.stopped=true;this.generation++;if(this.timer)clearTimeout(this.timer)}
 private schedule(delay=700){if(this.timer)clearTimeout(this.timer);if(!this.stopped&&!this.locked)this.timer=setTimeout(()=>void this.sync(),Math.max(delay,this.nextAttemptAt-Date.now()))}
 async lock(message='Войдите, чтобы открыть доску.'){
  this.locked=true;this.generation++;if(this.timer)clearTimeout(this.timer);
  const key=this.key;await this.work;
  try{if(key)await this.store.mutate(key,r=>({...r!,allowed:false}));else {const active=await this.store.active();if(active)await this.store.mutate(active.key,r=>({...r!,allowed:false}))}await this.store.activate(null)}finally{
   this.emit({board:empty(),session:null,ready:false,syncing:false,conflicts:[],drafts:[],legacy:undefined,pending:0,status:'Нужен вход',error:message});
  }
 }
 enqueue(operation:SyncOperation){
  if(this.locked||!this.state.ready||!canWrite(this.state.session?.role??null)||this.state.conflicts.length||this.state.storageFailed)return false;
  if(equal(operation.base,operation.data))return true;
  const board=mergeBoards(operation.base,operation.data,this.state.board,{},true).data;
  // The server cannot store a board over the D1 row limit. Refuse it here, before it
  // enters the durable queue, so it can never block later edits behind a 413.
  if(boardBytes(board)>MAX_BOARD_BYTES&&boardBytes(board)>boardBytes(this.state.board)){this.emit({tooLarge:true});return false;}
  this.waiting.push(operation);this.emit({board,tooLarge:false,status:'Сохраняем на устройстве…',pending:this.state.pending+1});
  const key=this.key;
  void this.persist(async()=>{const record=await this.store.mutate(key,r=>{
   if(!r?.allowed)throw new Error('Офлайн-доступ закрыт.');const tail=r.queue.at(-1);
   if(tail&&!tail.sealed&&equal(tail.operation.data,operation.base))tail.operation.data=operation.data;
   else r.queue.push({operation,sealed:false});return r;
  });this.waiting=this.waiting.filter(o=>o.id!==operation.id);this.apply(record);this.status();this.schedule()}).catch(()=>{});
  return true;
 }
 update(data:Board){return this.enqueue({id:crypto.randomUUID(),base:this.state.board,data})}
 async draft(draft:Draft|null,id:string){
  if(this.locked||!this.key||!canWrite(this.state.session?.role??null))return;
  const key=this.key;await this.persist(async()=>{const record=await this.store.mutate(key,r=>{if(!r)throw new Error('Нет локальной доски.');r.drafts=r.drafts.filter(d=>d.id!==id);if(draft)r.drafts.push(draft);return r});this.apply(record)});
 }
 async adoptDraft(draft:Draft,newId:string){
  if(this.locked)return;
  await this.persist(async()=>{const record=await this.store.mutate(this.key,r=>{r!.drafts=r!.drafts.filter(d=>d.id!==draft.id);r!.drafts.push({...draft,id:newId});return r!});this.apply(record)});
 }
 async refreshLocal(){if(this.locked||!this.key||this.busy||this.waiting.length)return;const r=await this.store.get(this.key);if(r)this.apply(r)}
 retry(){return this.sync(false,true)}
 async sync(boot=false,forceNetwork=false){
  await this.restoring;
  if(this.stopped||this.locked||this.state.storageFailed)return;
  if(this.busy){if(forceNetwork){this.retryRequested=true;if(!this.state.status.startsWith('Связь медленная'))this.emit({syncing:true,status:'Синхронизируем…'})}return;}
  if(!forceNetwork&&Date.now()<this.nextAttemptAt){this.schedule();return;}
  this.busy=true;
  if(this.timer)clearTimeout(this.timer);
  const previousError=this.state.error;
  // Routine successful polling stays quiet. Recovery and explicit retries show progress.
  const visible=forceNetwork||this.state.offline||this.state.pending>0||!!this.state.error;
  this.emit({syncing:visible,...(visible?{status:'Синхронизируем…'}:{}),error:this.state.conflicts.length?this.state.error:''});
  const generation=this.generation;
  const progressStarted=Date.now();
  // Keep the request alive for a slow connection, but stop an indefinite spinner.
  const progressTimer=setTimeout(()=>{if(this.busy&&!this.stopped&&!this.locked&&generation===this.generation&&!this.state.storageFailed)this.emit({syncing:false,status:'Связь медленная · изменения сохранены на устройстве'})},4000);
  let phase:'network'|'storage'='network';
  try{
   await this.work;
   const cached=this.key?await this.store.get(this.key):undefined;
   const known=cached?.allowed?{data:cached.base,revision:cached.revision,session:cached.session}:undefined;
   const snapshot=await this.transport.read({forceNetwork,known});const key=accountKey(snapshot.session);
   if(this.stopped||this.locked||this.state.storageFailed||generation!==this.generation)return;
   if(this.key&&key!==this.key){await this.lock('Аккаунт изменён. Обновите страницу для новой доски.');return;}
   this.key=key;
   phase='storage';
   let record=await this.store.mutate(key,r=>{
    if(!r)r={key,session:snapshot.session,base:snapshot.data||empty(),revision:snapshot.revision,queue:[],drafts:[],allowed:true};
    if(snapshot.revision>=r.revision){r.base=snapshot.data||empty();r.revision=snapshot.revision}
    r.session=snapshot.session;r.allowed=true;return r;
   });
   await this.store.activate(key);
   // Migrate the previous local backup without silently overwriting newer server data.
   if(boot&&typeof localStorage!=='undefined'){
    const legacyKey='oblaka-pending-'+snapshot.session.userId;const text=localStorage.getItem(legacyKey);
    if(text){try{const old=JSON.parse(text);if(old?.data?.notes){record=await this.store.mutate(key,r=>{if(!r!.legacy){if(old.revision===r!.revision&&!r!.queue.length)r!.queue.push({operation:{id:crypto.randomUUID(),base:r!.base,data:old.data},sealed:false});else r!.legacy=old.data}return r!});if(equal(record.legacy,old.data)||record.queue.some(q=>equal(q.operation.data,old.data)))localStorage.removeItem(legacyKey)}}catch{this.emit({error:'Не удалось перенести старую локальную копию. Она оставлена в браузере.'})}}
   }
   this.emit({offline:false,error:'',storageFailed:false});this.apply(record);
   if(!snapshot.data&&record.queue.length===0&&canWrite(snapshot.session.role)){this.update(this.initial());await this.work;record=(await this.store.get(key))!}
   else if(!record.base.notes.some(n=>n.id==='__focus_tasks__')&&canWrite(snapshot.session.role)){this.update(ensureFocusBoard(this.state.board));await this.work;record=(await this.store.get(key))!}
   if(!canWrite(record.session.role)){this.emit({status:'Доступ только для просмотра',error:record.queue.length?'Права изменены. Локальные правки сохранены, но отправить их может только редактор.':''});return;}
   // Each iteration rereads the transactionally stored queue, including other tabs' edits.
   const started=Date.now();
   for(let sent=0;sent<4;sent++){
    await this.work;record=await this.store.mutate(key,r=>{
     const first=r!.queue[0];
     if(first&&!first.sealed){
      // Persist the chosen protocol along with the seal. A lost response is retried
      // with exactly the same UUID, revision and payload, including after reload.
      if(this.transport.compact&&r!.revision>0&&equal(first.operation.base,r!.base))first.wireRevision=r!.revision;
      first.sealed=true;
     }return r!;
    });const first=record.queue[0];
    if(!first){this.failures=0;this.nextAttemptAt=0;this.emit({conflicts:[]});this.apply(record);this.status();return;}
    if(Date.now()-progressStarted<4000)this.emit({syncing:true,status:'Синхронизируем…'});
    phase='network';
    const response=await this.transport.send(first.operation,record.session,{forceNetwork,wireRevision:first.wireRevision});
    if(this.stopped||this.locked||this.state.storageFailed||generation!==this.generation)return;
    if(accountKey(response.session)!==key){await this.lock('Аккаунт изменён. Локальные правки сохранены отдельно.');return;}
    const conflict=response.conflicts||[];
    phase='storage';
    record=await this.store.mutate(key,r=>{
     if(response.revision>=r!.revision){r!.base=response.data;r!.revision=response.revision}r!.session=response.session;
     if(response.rebase){
      // The server rejected the stale revision without writing. Rotate the UUID
      // before falling back; never change a payload behind an existing receipt.
      r!.queue=r!.queue.map(q=>q.operation.id===first.operation.id?{operation:{...q.operation,id:crypto.randomUUID()},sealed:true}:q);
     }else if(!conflict.length)r!.queue=r!.queue.filter(q=>q.operation.id!==first.operation.id);
     return r!;
    });
    this.apply(record);
    if(conflict.length&&record.queue[0]?.operation.id===first.operation.id){this.emit({conflicts:conflict,status:'Нужно выбрать версию',error:'Одни и те же данные изменены на двух устройствах. Обе версии сохранены.'});return;}
    this.emit({conflicts:[],error:''});
    this.failures=0;this.nextAttemptAt=0;
    if(Date.now()-started>=8000&&record.queue.length)break;
   }
   this.schedule(100);
  }catch(error){
   if(this.stopped||this.locked||this.state.storageFailed||generation!==this.generation)return;
   if(phase==='storage'){this.emit({storageFailed:true,status:'Хранилище устройства недоступно',error:'Не удалось сохранить данные на устройстве. Не закрывайте страницу; скачайте копию доски.'});return;}
   if(error instanceof SyncError&&(error.status===401||error.status===403)){await this.lock(error.message);return;}
   if(error instanceof SyncError&&error.status>=400&&error.status<500){this.emit({error:error.message,status:'Не удалось синхронизировать'});return;}
   const knownOffline=error instanceof ConnectionError&&error.kind==='offline';
   const reason=error instanceof SyncError||error instanceof ConnectionError?error.message:'Не удалось связаться с сервером. Проверьте интернет и нажмите «Повторить».';
   this.emit({offline:!(error instanceof SyncError),status:knownOffline&&!forceNetwork?'Офлайн · сохранено на устройстве':'Не удалось синхронизировать',
    error:knownOffline&&!forceNetwork&&this.state.ready?previousError:reason+(this.state.ready?' Изменения сохранены на устройстве.':' Для первого открытия доски нужен интернет.')});
   // Focus/visibility/polling and additional edits must respect this backoff too.
   // An explicit Retry or a network-online event may bypass it.
   this.failures++;
   const delay=Math.min(60000,5000*2**Math.min(this.failures-1,4))*(0.9+Math.random()*0.2);
   this.nextAttemptAt=Date.now()+delay;this.schedule(delay);
  }finally{
   clearTimeout(progressTimer);
   this.busy=false;
   if(this.retryRequested&&!this.stopped&&!this.locked&&!this.state.storageFailed){this.retryRequested=false;await this.sync(false,true)}
   else{this.retryRequested=false;this.emit({syncing:false});this.status()}
   for(const done of this.syncWaiters.splice(0))done();
  }
 }
 async resolve(choices:Choices){
  if(!this.key||this.state.storageFailed)return;
  if(this.busy)await new Promise<void>(resolve=>this.syncWaiters.push(resolve));
  await this.persist(async()=>{const record=await this.store.mutate(this.key,r=>{
   const first=r!.queue[0];if(!first)return r!;
   const merged=mergeBoards(first.operation.base,first.operation.data,r!.base,choices);
   if(merged.conflicts.length)throw new Error('Выберите версию для каждого спорного поля.');
   r!.queue[0]={operation:{id:crypto.randomUUID(),base:r!.base,data:merged.data},sealed:false};return r!;
  });this.emit({conflicts:[],error:''});this.apply(record);this.status()});
  void this.sync();
 }
 async clearLegacy(){await this.persist(async()=>{const record=await this.store.mutate(this.key,r=>{delete r!.legacy;return r!});this.apply(record)})}
}
