import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {syncBoard} from '../app/sync-store.ts';
import {OfflineController,SyncError,ConnectionError} from '../app/offline-controller.ts';
import {syncNotice} from '../app/sync-status.ts';
import {accountKey} from '../app/offline-storage.ts';
const session={role:'editor',userId:'user',boardId:'shared',name:'User',email:'user@example.com'};
const note=(id,tasks)=>({id,title:id,text:'',tasks,color:'white',category:'',pinned:false,archived:false,deleted:false,created:'2026'});
const board=()=>({categories:[],notes:[note('__focus_tasks__',[]),note('a',[{id:'x',text:'x',done:false},{id:'y',text:'y',done:false}])]});
const edit=(b,f)=>{const v=structuredClone(b);f(v);return v};
const op=(base,data)=>({id:crypto.randomUUID(),base,data});
function db(){const sql=new DatabaseSync(':memory:');for(const n of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+n,'utf8'));
 return{sql,prepare(q){let args=[];const statement={bind(...v){args=v;return statement},async first(){return sql.prepare(q).get(...args)||null},async run(){return{meta:{changes:Number(sql.prepare(q).run(...args).changes)}}}};return statement},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}}};}
function seeded(){const d=db();d.sql.prepare('INSERT INTO boards VALUES (?,?,?,?)').run(session.boardId,JSON.stringify(board()),1,'now');return d}
test('server receipt makes response-loss replay idempotent, including subsequent remote edits',async()=>{
 const d=seeded(),b=board(),o=op(b,edit(b,v=>v.notes[1].tasks[0].done=true));const first=await syncBoard(d,session,o);assert.equal(first.revision,2);
 const remote=op(first.data,edit(first.data,v=>v.notes[1].tasks[1].text='remote'));await syncBoard(d,{...session,userId:'other'},remote);
 const retry=await syncBoard(d,session,o);assert.equal(retry.revision,3);assert.equal(retry.data.notes[1].tasks[1].text,'remote');assert.equal(d.sql.prepare('SELECT count(*) n FROM board_operations').get().n,2);
 await assert.rejects(syncBoard(d,session,{...o,data:b}),e=>e.status===400);
 await assert.rejects(syncBoard(d,{...session,userId:'other'},o),e=>e.status===400);
});
test('server checks role on replay and different users merge same board',async()=>{
 const d=seeded(),b=board(),a=op(b,edit(b,v=>v.notes[1].tasks[0].text='a')),c=op(b,edit(b,v=>v.notes[1].tasks[1].text='b'));
 await syncBoard(d,session,a);await assert.rejects(syncBoard(d,{...session,role:'viewer'},a),e=>e.status===403);
 const result=await syncBoard(d,{...session,userId:'other'},c);assert.deepEqual(result.data.notes[1].tasks.map(t=>t.text),['a','b']);
});
test('a conflict never writes or records a completed operation',async()=>{
 const d=seeded(),b=board();await syncBoard(d,session,op(b,edit(b,v=>v.notes[1].tasks[0].text='first')));
 const result=await syncBoard(d,session,op(b,edit(b,v=>v.notes[1].tasks[0].text='second')));assert.equal(result.conflicts.length,1);assert.equal(result.revision,2);assert.equal(d.sql.prepare('SELECT count(*) n FROM board_operations').get().n,1);
});
class MemoryStore{
 values=new Map();activeKey=null;fail=false;serial=Promise.resolve();
 async get(key){return structuredClone(this.values.get(key))}
 async active(){return this.get(this.activeKey)}
 async activate(key){this.activeKey=key}
 mutate(key,change){const next=this.serial.then(()=>{if(this.fail)throw new Error('quota');const value=change(structuredClone(this.values.get(key)));this.values.set(key,structuredClone(value));return structuredClone(value)});this.serial=next.catch(()=>{});return next}
}
function network(){const d=seeded();let offline=false,lost=false;return{
 d,setOffline(v){offline=v},loseNext(){lost=true},
 async read(){if(offline)throw new TypeError('network');const r=d.sql.prepare('SELECT data,revision FROM boards').get();return {session,data:JSON.parse(r.data),revision:r.revision}},
 async send(o,s){if(offline)throw new TypeError('network');const r=await syncBoard(d,s,o);if(lost){lost=false;throw new TypeError('response lost')}return {...r,session:s}},
}}
const settle=()=>new Promise(r=>setTimeout(r,30));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
test('retry stays quiet before the read resolves and after a successful empty-queue sync',async()=>{
 const store=new MemoryStore(),net=network();let read=()=>net.read();
 const c=new OfflineController(store,{...net,read:options=>read(options)},board);await c.start();
 read=async()=>{throw new ConnectionError('offline','Нет сети')};await c.sync();assert.equal(c.state.offline,true);assert.equal(syncNotice(c.state),null);
 const pending=deferred();let force;read=options=>{force=options.forceNetwork;return pending.promise};
 const attempt=c.retry();await settle();assert.equal(c.state.syncing,true);assert.equal(syncNotice(c.state),null);assert.equal(force,true);
 pending.resolve(await net.read());await attempt;
 assert.equal(c.state.offline,false);assert.equal(c.state.error,'');assert.equal(c.state.syncing,false);assert.equal(syncNotice(c.state),null);c.stop();
});
test('queued edits await server acknowledgement without showing a progress banner',async()=>{
 const store=new MemoryStore(),net=network();let send=(...args)=>net.send(...args);
 const c=new OfflineController(store,{...net,send:(...args)=>send(...args)},board);await c.start();net.setOffline(true);
 c.update(edit(c.state.board,v=>v.notes[1].tasks[0].text='local'));await settle();await c.sync();net.setOffline(false);
 const acknowledgement=deferred();let operation,actor,force;
 send=(o,s,options)=>{operation=o;actor=s;force=options.forceNetwork;return acknowledgement.promise};
 const attempt=c.retry();await settle();
 assert.equal(c.state.offline,false);assert.equal(c.state.pending,1);assert.equal(c.state.syncing,true);assert.equal(syncNotice(c.state),null);assert.equal(force,true);
 acknowledgement.resolve(await net.send(operation,actor));await attempt;
 assert.equal(c.state.pending,0);assert.equal(syncNotice(c.state),null);assert.equal((await net.read()).data.notes[1].tasks[0].text,'local');c.stop();
});
test('retry failures show the actual timeout/server/network error and preserve the durable queue',async()=>{
 for(const error of [new ConnectionError('timeout','Сервер не ответил вовремя.'),new SyncError('Сервер недоступен (503).',503),new ConnectionError('network','Не удалось связаться с сервером.')]){
  const store=new MemoryStore(),net=network();let send=(...args)=>net.send(...args);
  const c=new OfflineController(store,{...net,send:(...args)=>send(...args)},board);await c.start();
  c.update(edit(c.state.board,v=>v.notes[1].title='pending'));await settle();send=async()=>{throw error};
  await c.retry();assert.equal(syncNotice(c.state).kind,'error');assert.ok(c.state.error.includes(error.message));
  assert.equal(c.state.syncing,false);assert.equal(c.state.pending,1);assert.equal((await store.get(accountKey(session))).queue.length,1);
  send=(...args)=>net.send(...args);await c.retry();assert.equal(syncNotice(c.state),null);assert.equal(c.state.pending,0);c.stop();
 }
});
test('a reconnect while a request is busy schedules one real retry instead of silently ignoring it',async()=>{
 const store=new MemoryStore(),net=network();let read=options=>net.read(options);
 const c=new OfflineController(store,{...net,read:options=>read(options)},board);await c.start();
 const stale=deferred(),calls=[];read=options=>{calls.push(options.forceNetwork);return calls.length===1?stale.promise:net.read()};
 const first=c.sync();await settle();await c.retry();await c.retry();assert.equal(c.state.syncing,true);assert.equal(syncNotice(c.state),null);
 stale.reject(new TypeError('stale offline request'));await first;
 assert.deepEqual(calls,[false,true]);assert.equal(syncNotice(c.state),null);c.stop();
});
test('routine online polling stays quiet; explicit retry without internet reports a failure',async()=>{
 const store=new MemoryStore(),net=network();let read=()=>net.read();
 const c=new OfflineController(store,{...net,read:()=>read()},board);await c.start();const pending=deferred();read=()=>pending.promise;
 const polling=c.sync();await settle();assert.equal(syncNotice(c.state),null);pending.resolve(await net.read());await polling;
 read=async()=>{throw new ConnectionError('offline','Нет подключения к интернету.')};await c.retry();
 assert.equal(syncNotice(c.state).kind,'error');assert.match(c.state.error,/Нет подключения/);c.stop();
});
test('automatic offline checks do not erase a failed manual retry message',async()=>{
 const store=new MemoryStore(),net=network();let read=()=>net.read();
 const c=new OfflineController(store,{...net,read:()=>read()},board);await c.start();
 read=async()=>{throw new ConnectionError('network','Не удалось связаться с сервером.')};await c.retry();const message=c.state.error;
 read=async()=>{throw new ConnectionError('offline','Нет сети')};await c.sync();assert.equal(syncNotice(c.state).kind,'error');assert.equal(c.state.error,message);
 read=()=>net.read();await c.retry();assert.equal(syncNotice(c.state),null);c.stop();
});
test('a network result cannot replace an unsaved-storage error with a saved or synced message',async()=>{
 for(const failNetwork of [true,false]){
  const store=new MemoryStore(),net=network();let read=()=>net.read();
  const c=new OfflineController(store,{...net,read:()=>read()},board);await c.start();const pending=deferred();read=()=>pending.promise;
  const polling=c.retry();await settle();store.fail=true;c.update(edit(c.state.board,v=>v.notes[1].title='not saved'));await settle();
  const error=c.state.error;assert.equal(c.state.storageFailed,true);
  if(failNetwork)pending.reject(new TypeError('network'));else pending.resolve(await net.read());await polling;
  assert.equal(syncNotice(c.state).kind,'error');assert.equal(c.state.error,error);assert.equal(c.state.board.notes[1].title,'not saved');c.stop();
 }
});
test('cached board, queue and draft open while the network is still unresolved; new edits merge after validation',async()=>{
 const store=new MemoryStore(),net=network(),first=new OfflineController(store,net,board);
 await first.start();net.setOffline(true);
 first.update(edit(first.state.board,v=>v.notes[1].tasks[0].text='saved offline'));
 await first.draft({id:'draft',original:first.state.board.notes[1],note:{...first.state.board.notes[1],title:'draft title'},updatedAt:1},'draft');
 await first.sync();first.stop();net.setOffline(false);
 const pending=deferred();let sent=0;
 const second=new OfflineController(store,{read:()=>pending.promise,send:async(...args)=>{sent++;return net.send(...args)}},board);
 const starting=second.start();await settle();
 assert.equal(second.state.ready,true);assert.equal(second.state.board.notes[1].tasks[0].text,'saved offline');
 assert.equal(second.state.drafts[0].note.title,'draft title');assert.equal(second.state.pending,1);assert.equal(sent,0);
 assert.equal(second.update(edit(second.state.board,v=>v.notes[1].tasks[1].text='edited before network')),true);
 await settle();assert.equal(sent,0);
 const remote=await net.read();await syncBoard(net.d,{...session,userId:'other'},op(remote.data,edit(remote.data,v=>v.notes[1].title='remote title')));
 pending.resolve(await net.read());await starting;
 assert.equal(second.state.pending,0);assert.equal(second.state.board.notes[1].title,'remote title');
 assert.deepEqual(second.state.board.notes[1].tasks.map(t=>t.text),['saved offline','edited before network']);second.stop();
});
test('a denied or absent local record is not shown during a stalled request',async()=>{
 for(const denied of [false,true]){
  const store=new MemoryStore(),net=network();
  if(denied){const first=new OfflineController(store,net,board);await first.start();first.stop();await store.mutate(accountKey(session),r=>({...r,allowed:false}))}
  const pending=deferred(),c=new OfflineController(store,{...net,read:()=>pending.promise},board);
  const starting=c.start();await settle();assert.equal(c.state.ready,false);assert.equal(c.state.board.notes.length,0);
  pending.reject(new TypeError('offline'));await starting;assert.equal(c.state.ready,false);c.stop();
 }
});
test('background authentication failure clears a board already restored from the device',async()=>{
 const store=new MemoryStore(),net=network(),first=new OfflineController(store,net,board);await first.start();first.stop();
 const pending=deferred(),c=new OfflineController(store,{...net,read:()=>pending.promise},board);
 const starting=c.start();await settle();assert.equal(c.state.ready,true);
 pending.reject(new SyncError('revoked',403));await starting;
 assert.equal(c.state.ready,false);assert.equal(c.state.board.notes.length,0);assert.equal(store.activeKey,null);c.stop();
});
test('logout during background validation cannot reopen or send the cached board',async()=>{
 const store=new MemoryStore(),net=network(),first=new OfflineController(store,net,board);await first.start();first.stop();
 const pending=deferred();let sent=0;
 const c=new OfflineController(store,{read:()=>pending.promise,send:async(...args)=>{sent++;return net.send(...args)}},board);
 const starting=c.start();await settle();c.update(edit(c.state.board,v=>v.notes[1].title='local'));
 await c.lock();pending.resolve(await net.read());await starting;await c.sync();
 assert.equal(c.state.ready,false);assert.equal(c.state.board.notes.length,0);assert.equal(store.activeKey,null);assert.equal(sent,0);
 assert.equal((await store.get(accountKey(session))).queue.length,1);c.stop();
});
test('offline edits survive a cold reload and sync once after reconnection',async()=>{
 const store=new MemoryStore(),net=network(),c=new OfflineController(store,net,board);await c.start();net.setOffline(true);
 c.update(edit(c.state.board,v=>v.notes[1].tasks[0].text='offline'));await settle();await c.sync();c.stop();assert.equal(c.state.offline,true);
 const second=new OfflineController(store,net,board);await second.start();assert.equal(second.state.ready,true);assert.equal(second.state.board.notes[1].tasks[0].text,'offline');assert.equal(second.state.pending,1);
 net.setOffline(false);await second.retry();assert.equal(second.state.pending,0);assert.equal(second.state.board.notes[1].tasks[0].text,'offline');second.stop();
});
test('response loss retains the sealed operation; new edits queue behind it',async()=>{
 const store=new MemoryStore(),net=network(),c=new OfflineController(store,net,board);await c.start();c.update(edit(c.state.board,v=>v.notes[1].tasks[0].text='first'));await settle();net.loseNext();await c.sync();assert.equal(c.state.pending,1);
 c.update(edit(c.state.board,v=>v.notes[1].tasks[1].text='second'));await settle();assert.equal(c.state.pending,2);await c.retry();assert.equal(c.state.pending,0);assert.deepEqual(c.state.board.notes[1].tasks.map(t=>t.text),['first','second']);assert.equal(net.d.sql.prepare('SELECT count(*) n FROM board_operations').get().n,2);c.stop();
});
test('drafts persist without publishing them and cancellation clears only that draft',async()=>{
 const store=new MemoryStore(),net=network(),c=new OfflineController(store,net,board);await c.start();const draft={id:'draft',original:c.state.board.notes[1],note:{...c.state.board.notes[1],title:'unsaved'},updatedAt:Date.now()};await c.draft(draft,draft.id);assert.equal((await net.read()).data.notes[1].title,'a');c.stop();net.setOffline(true);const second=new OfflineController(store,net,board);await second.start();assert.equal(second.state.drafts[0].note.title,'unsaved');await second.draft(null,draft.id);assert.equal(second.state.drafts.length,0);second.stop();
});
test('unauthorized response locks offline access, even after a later network failure',async()=>{
 const store=new MemoryStore(),net=network(),c=new OfflineController(store,net,board);await c.start();c.stop();const denied={...net,read:async()=>{throw new SyncError('revoked',403)}};const second=new OfflineController(store,denied,board);await second.start();assert.equal(second.state.ready,false);assert.equal(store.activeKey,null);second.stop();net.setOffline(true);const third=new OfflineController(store,net,board);await third.start();assert.equal(third.state.ready,false);third.stop();
});
test('other account never receives cached tasks; viewer cannot enqueue',async()=>{
 const store=new MemoryStore(),net=network(),c=new OfflineController(store,net,board);await c.start();c.stop();const other={role:'viewer',userId:'another',boardId:'other',name:'A',email:'a@example.com'};const second=new OfflineController(store,{read:async()=>({data:{notes:[],categories:[]},revision:1,session:other}),send:async()=>{throw new Error('must not send')}},board);await second.start();assert.equal(second.state.board.notes.length,0);assert.equal(second.update(board()),false);assert.notEqual(accountKey(other),accountKey(session));second.stop();
});
test('storage errors retain the unsaved in-memory data and never send it',async()=>{
 const store=new MemoryStore(),net=network(),c=new OfflineController(store,net,board);await c.start();store.fail=true;c.update(edit(c.state.board,v=>v.notes[1].tasks[0].text='not saved'));await settle();assert.equal(c.state.storageFailed,true);assert.equal(c.state.board.notes[1].tasks[0].text,'not saved');await c.sync();assert.equal((await net.read()).data.notes[1].tasks[0].text,'x');c.stop();
});
test('two tabs retain independent edits in the same durable queue',async()=>{
 const store=new MemoryStore(),net=network(),a=new OfflineController(store,net,board),b=new OfflineController(store,net,board);await a.start();await b.start();net.setOffline(true);a.update(edit(a.state.board,v=>v.notes[1].tasks[0].text='a'));b.update(edit(b.state.board,v=>v.notes[1].tasks[1].text='b'));await settle();net.setOffline(false);await a.sync();await b.sync();assert.deepEqual(b.state.board.notes[1].tasks.map(t=>t.text),['a','b']);a.stop();b.stop();
});
test('a conflict survives reload and the chosen version is sent as a new operation',async()=>{
 const store=new MemoryStore(),net=network(),c=new OfflineController(store,net,board);await c.start();const original=c.state.board;c.update(edit(original,v=>v.notes[1].tasks[0].text='local'));await settle();await syncBoard(net.d,{...session,userId:'other'},op(original,edit(original,v=>v.notes[1].tasks[0].text='remote')));await c.sync();assert.equal(c.state.conflicts.length,1);c.stop();const second=new OfflineController(store,net,board);await second.start();assert.equal(second.state.conflicts.length,1);await second.resolve({[second.state.conflicts[0].key]:'remote'});await settle();assert.equal(second.state.board.notes[1].tasks[0].text,'remote');assert.equal(second.state.pending,0);second.stop();
});

test('conditional board read returns only a revision for unchanged data, but returns other accounts data independently',async()=>{
 const {readBoardSince}=await import('../app/board-store.ts');const d=seeded();
 const same=await readBoardSince(d,session,1);assert.equal(same.unchanged,true);assert.equal(same.data,undefined);
 assert.deepEqual((await readBoardSince(d,session,0)).data,board());
 const other=await readBoardSince(d,{...session,boardId:'other'},1);assert.equal(other.data,null);assert.equal(other.unchanged,undefined);
});
const compactNetwork=()=>{
 const net=network(),calls=[];let lost=false;
 return {...net,compact:true,calls,loseCompactResponse(){lost=true},async send(operation,actor,options){
  calls.push({id:operation.id,revision:options.wireRevision});
  let result;
  if(options.wireRevision===undefined)result=await net.send(operation,actor);
  else {
   const {syncCompactBoard}=await import('../app/sync-store.ts');const {difference}=await import('../app/board-delta.ts');
   result={...await syncCompactBoard(net.d,actor,{id:operation.id,revision:options.wireRevision,delta:difference(operation.base,operation.data)}),session:actor};
  }
  if(lost){lost=false;throw new TypeError('response lost')};return result;
 }};
};
test('compact edits remain idempotent across response loss, cold reload, remote edits and another actor',async()=>{
 const {syncCompactBoard}=await import('../app/sync-store.ts');const {difference}=await import('../app/board-delta.ts');
 const d=seeded(),base=board(),data=edit(base,v=>v.notes[1].tasks[0].done=true),operation={id:crypto.randomUUID(),revision:1,delta:difference(base,data)};
 const first=await syncCompactBoard(d,session,operation);assert.equal(first.acknowledged,true);assert.equal(first.revision,2);
 await syncBoard(d,{...session,userId:'other'},op(first.data,edit(first.data,v=>v.notes[1].title='remote')));
 const replay=await syncCompactBoard(d,session,operation);assert.equal(replay.revision,3);assert.equal(replay.data.notes[1].title,'remote');
 await assert.rejects(syncCompactBoard(d,session,{...operation,delta:difference(base,base)}),e=>e.status===400);
 await assert.rejects(syncCompactBoard(d,{...session,userId:'other'},operation),e=>e.status===400);
 await assert.rejects(syncCompactBoard(d,{...session,role:'viewer'},operation),e=>e.status===403);
 const stale=await syncCompactBoard(d,session,{...operation,id:crypto.randomUUID()});assert.equal(stale.rebase,true);assert.equal(d.sql.prepare('SELECT revision FROM boards').get().revision,3);
});
test('a sealed compact operation keeps its wire revision and UUID after reload even if the board advanced',async()=>{
 const net=compactNetwork(),store=new MemoryStore(),c=new OfflineController(store,net,board);await c.start();
 c.update(edit(c.state.board,v=>v.notes[1].title='local'));await settle();net.loseCompactResponse();await c.retry();
 const queued=(await store.get(accountKey(session))).queue[0];assert.equal(queued.wireRevision,1);assert.equal(queued.sealed,true);c.stop();
 const current=await net.read();await syncBoard(net.d,{...session,userId:'other'},op(current.data,edit(current.data,v=>v.notes[1].tasks[1].text='remote')));
 const second=new OfflineController(store,net,board);await second.start();assert.equal(second.state.pending,0);
 assert.deepEqual(net.calls[0],net.calls[1]);assert.equal(second.state.board.notes[1].tasks[1].text,'remote');second.stop();
});
test('concurrent change after GET rejects delta then safely merges full snapshots with a new UUID',async()=>{
 const net=compactNetwork(),store=new MemoryStore();let race=true;
 const c=new OfflineController(store,{...net,send:async(...args)=>{
  if(race){race=false;const current=await net.read();await syncBoard(net.d,{...session,userId:'other'},op(current.data,edit(current.data,v=>v.notes[1].tasks[1].text='other device')))}
  return net.send(...args);
 }},board);await c.start();c.update(edit(c.state.board,v=>v.notes[1].tasks[0].text='local'));await settle();await c.retry();
 assert.equal(c.state.pending,0);assert.deepEqual(c.state.board.notes[1].tasks.map(t=>t.text),['local','other device']);
 assert.equal(net.calls[0].revision,1);assert.equal(net.calls[1].revision,undefined);assert.notEqual(net.calls[0].id,net.calls[1].id);
 assert.equal(net.d.sql.prepare('SELECT count(*) n FROM board_operations').get().n,2);c.stop();
});
test('compact fallback still surfaces same-field conflicts and retains offline edits',async()=>{
 const net=compactNetwork(),store=new MemoryStore();let race=true;
 const c=new OfflineController(store,{...net,send:async(...args)=>{
  if(race){race=false;const current=await net.read();await syncBoard(net.d,{...session,userId:'other'},op(current.data,edit(current.data,v=>v.notes[1].tasks[0].text='remote')))}
  return net.send(...args);
 }},board);await c.start();c.update(edit(c.state.board,v=>v.notes[1].tasks[0].text='local'));await settle();await c.retry();
 assert.equal(c.state.pending,1);assert.equal(c.state.conflicts.length,1);assert.equal((await net.read()).data.notes[1].tasks[0].text,'remote');c.stop();
});
test('automatic focus/poll/edit triggers respect network backoff; manual Retry bypasses it',async()=>{
 const net=network(),store=new MemoryStore();let reads=0,fail=true;
 const c=new OfflineController(store,{...net,read:async()=>{reads++;if(fail)throw new TypeError('weak network');return net.read()}},board);
 await c.start();assert.equal(reads,1);await c.sync();await c.sync();assert.equal(reads,1);
 fail=false;await c.retry();assert.equal(reads,2);assert.equal(c.state.error,'');c.stop();
});
test('slow background sync stays quiet while awaiting acknowledgement',async t=>{
 const store=new MemoryStore(),net=network();let read=()=>net.read();
 const c=new OfflineController(store,{...net,read:()=>read()},board);await c.start();
 t.after(()=>c.stop());t.mock.timers.enable({apis:['setTimeout']});
 const waiting=deferred();read=()=>waiting.promise;const attempt=c.retry();
 for(let i=0;i<20;i++)await Promise.resolve();assert.equal(c.state.syncing,true);
 t.mock.timers.tick(4000);assert.equal(c.state.syncing,false);assert.match(c.state.status,/Связь медленная/);assert.equal(syncNotice(c.state),null);
 waiting.resolve(await net.read());await attempt;assert.equal(syncNotice(c.state),null);
});
