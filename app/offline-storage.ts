import {type Board,type Note} from './board-model.ts';
import {type Session} from './access-model.ts';
import {type SyncOperation} from './board-merge.ts';
export type Draft={id:string;original:Note|null;note:Note;updatedAt:number};
export type OfflineRecord={key:string;session:Session;base:Board;revision:number;queue:{operation:SyncOperation;sealed:boolean;wireRevision?:number}[];drafts:Draft[];allowed:boolean;legacy?:Board};
export interface OfflineStorage{
 active():Promise<OfflineRecord|undefined>;
 get(key:string):Promise<OfflineRecord|undefined>;
 mutate(key:string,change:(record:OfflineRecord|undefined)=>OfflineRecord):Promise<OfflineRecord>;
 activate(key:string|null):Promise<void>;
}
export const accountKey=(s:Session)=>JSON.stringify([s.userId,s.boardId]);
export class BrowserStorage implements OfflineStorage{
 private connection:Promise<IDBDatabase>|undefined;
 private open(){return this.connection??=new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open('oblaka-offline',1);
  request.onupgradeneeded=()=>{request.result.createObjectStore('boards',{keyPath:'key'});request.result.createObjectStore('meta')};
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db)};
  request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Закройте другие вкладки «Облаков» для обновления хранилища.'));
 })}
 async get(key:string){const db=await this.open();return new Promise<OfflineRecord|undefined>((resolve,reject)=>{const req=db.transaction('boards').objectStore('boards').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
 async active(){const db=await this.open();const key=await new Promise<string|undefined>((resolve,reject)=>{const req=db.transaction('meta').objectStore('meta').get('active');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});return key?this.get(key):undefined}
 async activate(key:string|null){const db=await this.open();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put(key,'active');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error)})}
 async mutate(key:string,change:(r:OfflineRecord|undefined)=>OfflineRecord){
  const db=await this.open();return new Promise<OfflineRecord>((resolve,reject)=>{
   const tx=db.transaction('boards','readwrite');const store=tx.objectStore('boards');let result:OfflineRecord;
   const req=store.get(key);req.onsuccess=()=>{try{result=change(req.result);store.put(result)}catch(error){tx.abort();reject(error)}};
   tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||new Error('Локальное сохранение прервано.'));tx.onerror=()=>reject(tx.error);
  });
 }
}
