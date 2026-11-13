import test from 'node:test';
import assert from 'node:assert/strict';
import {requestSnapshot} from '../app/offline-transport.ts';
import {ConnectionError,SyncError} from '../app/sync-errors.ts';

const snapshot={data:{notes:[],categories:[]},revision:1,session:{userId:'user',boardId:'shared',role:'editor'}};
function online(t,value){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{value:{onLine:value},configurable:true});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator});
}
test('manual retry reaches the server despite a stale offline hint; automatic offline requests stay local',async t=>{
 online(t,false);const fetch=t.mock.method(globalThis,'fetch',async()=>Response.json(snapshot));
 await assert.rejects(requestSnapshot('/api/board'),e=>e instanceof ConnectionError&&e.kind==='offline');assert.equal(fetch.mock.callCount(),0);
 assert.deepEqual(await requestSnapshot('/api/board',{}, {forceNetwork:true}),snapshot);assert.equal(fetch.mock.callCount(),1);
 const options=fetch.mock.calls[0].arguments[1];assert.equal(options.cache,'no-store');assert.equal(options.redirect,'manual');
});
test('HTML 503 is reported as a server failure, not logout or ordinary offline',async t=>{
 online(t,true);t.mock.method(globalThis,'fetch',async()=>new Response('<html>Unavailable</html>',{status:503,headers:{'content-type':'text/html'}}));
 await assert.rejects(requestSnapshot('/api/board'),e=>e instanceof SyncError&&e.status===503&&e.message.includes('503'));
});
test('network failure has a readable retry message',async t=>{
 online(t,true);t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('Failed to fetch')});
 await assert.rejects(requestSnapshot('/api/board'),e=>e instanceof ConnectionError&&e.kind==='network'&&e.message.includes('Повторить'));
});
test('a stalled request times out with an explicit message',async t=>{
 online(t,true);t.mock.timers.enable({apis:['setTimeout']});
 t.mock.method(globalThis,'fetch',(_path,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})));
 const pending=requestSnapshot('/api/board');t.mock.timers.tick(20000);
 await assert.rejects(pending,e=>e instanceof ConnectionError&&e.kind==='timeout'&&e.message.includes('не ответил вовремя'));
});
test('authentication walls remain auth errors and conflict responses remain valid snapshots',async t=>{
 online(t,true);const fetch=t.mock.method(globalThis,'fetch',async()=>new Response('Unauthorized',{status:401}));
 await assert.rejects(requestSnapshot('/api/board'),e=>e instanceof SyncError&&e.status===401);
 fetch.mock.mockImplementation(async()=>Response.json({...snapshot,conflicts:[{key:'field'}]},{status:409}));
 assert.equal((await requestSnapshot('/api/board/sync')).conflicts.length,1);
});
test('invalid JSON and incomplete responses do not count as successful sync',async t=>{
 online(t,true);const fetch=t.mock.method(globalThis,'fetch',async()=>new Response('{bad',{headers:{'content-type':'application/json'}}));
 await assert.rejects(requestSnapshot('/api/board'),e=>e instanceof SyncError&&e.status===502);
 fetch.mock.mockImplementation(async()=>Response.json({ok:true}));
 await assert.rejects(requestSnapshot('/api/board'),e=>e instanceof SyncError&&e.status===502);
});

test('conditional reads transfer no board and reject an unchanged response for another account or revision',async t=>{
 const {readSnapshot}=await import('../app/offline-transport.ts');online(t,true);
 const fetch=t.mock.method(globalThis,'fetch',async()=>Response.json({session:snapshot.session,revision:1,unchanged:true}));
 const result=await readSnapshot({known:snapshot});assert.deepEqual(result.data,snapshot.data);
 assert.equal(fetch.mock.calls[0].arguments[1].headers['X-Oblaka-Revision'],'1');
 fetch.mock.mockImplementation(async()=>Response.json({session:{...snapshot.session,userId:'other'},revision:1,unchanged:true}));
 await assert.rejects(readSnapshot({known:snapshot}),e=>e instanceof SyncError&&e.status===502);
 fetch.mock.mockImplementation(async()=>Response.json({session:snapshot.session,revision:2,unchanged:true}));
 await assert.rejects(readSnapshot({known:snapshot}),e=>e instanceof SyncError&&e.status===502);
});
test('compact upload and matching acknowledgement avoid both full snapshots; wrong receipt cannot clear local edits',async t=>{
 const {sendSnapshot}=await import('../app/offline-transport.ts');online(t,true);
 const operation={id:crypto.randomUUID(),base:snapshot.data,data:{...snapshot.data,labels:['жду']}};
 const fetch=t.mock.method(globalThis,'fetch',async()=>Response.json({session:snapshot.session,revision:2,acknowledged:true,operationId:operation.id}));
 const result=await sendSnapshot(operation,snapshot.session,{wireRevision:1});assert.deepEqual(result.data,operation.data);
 const sent=JSON.parse(fetch.mock.calls[0].arguments[1].body);assert.equal(sent.operation.base,undefined);assert.equal(sent.operation.data,undefined);assert.equal(sent.operation.revision,1);
 fetch.mock.mockImplementation(async()=>Response.json({session:snapshot.session,revision:2,acknowledged:true,operationId:'wrong'}));
 await assert.rejects(sendSnapshot(operation,snapshot.session,{wireRevision:1}),e=>e instanceof SyncError&&e.status===502);
});
