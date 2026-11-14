import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {syncBoard} from '../app/sync-store.ts';
import {OfflineController,SyncError,ConnectionError} from '../app/offline-controller.ts';
import {syncNotice} from '../app/sync-status.ts';
import {accountKey} from '../app/offline-storage.ts';
const session={role:'admin',userId:'user',boardId:'shared',name:'User',email:'user@example.com'};
const note=(id,tasks)=>({id,title:id,text:'',tasks,color:'white',category:'',pinned:false,archived:false,deleted:false,created:'2026'});
const board=()=>({categories:[],notes:[note('__focus_tasks__',[]),note('a',[{id:'x',text:'x',done:false},{id:'y',text:'y',done:false}])]});
const edit=(b,f)=>{const v=structuredClone(b);f(v);return v};
const op=(base,data)=>({id:crypto.randomUUID(),base,data});
function db(){const sql=new DatabaseSync(':memory:');for(const n of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+n,'utf8'));
 return{sql,prepare(q){let args=[];const statement={bind(...v){args=v;return statement},async first(){return sql.prepare(q).get(...args)||null},async all(){return{results:sql.prepare(q).all(...args)}},async run(){return{meta:{changes:Number(sql.prepare(q).run(...args).changes)}}}};return statement},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}}};}
function seeded(){const d=db();d.sql.prepare('INSERT INTO boards VALUES (?,?,?,?)').run(session.boardId,JSON.stringify(board()),1,'now');return d}
class MemoryStore{
 values=new Map();activeKey=null;fail=false;serial=Promise.resolve();
 async get(key){return structuredClone(this.values.get(key))}
 async active(){return this.get(this.activeKey)}
 async activate(key){this.activeKey=key}
 mutate(key,change){const next=this.serial.then(()=>{if(this.fail)throw new Error('quota');const value=change(structuredClone(this.values.get(key)));this.values.set(key,structuredClone(value));return structuredClone(value)});this.serial=next.catch(()=>{});return next}
}
const settle=()=>new Promise(r=>setTimeout(r,30));

const {MAX_BOARD_BYTES,BOARD_TOO_LARGE}=await import('../app/board-model.ts');
const {syncCompactBoard}=await import('../app/sync-store.ts');
const {difference}=await import('../app/board-delta.ts');
const {writeSharedBoard}=await import('../app/board-store.ts');
// Many tasks of ~9 KB keep each note within schema limits while crossing the row limit.
const huge=b=>edit(b,v=>{v.notes[1].tasks=Array.from({length:230},(_,i)=>({id:'big'+i,text:'я'.repeat(4500),done:false}))});

test('server refuses a merged board above the D1 row limit and writes nothing',async()=>{
 const d=seeded();const before=d.sql.prepare('SELECT data,revision FROM boards').get();
 assert.ok(new TextEncoder().encode(JSON.stringify(huge(board()))).length>MAX_BOARD_BYTES);
 await assert.rejects(syncBoard(d,session,op(board(),huge(board()))),e=>e.status===413&&e.message===BOARD_TOO_LARGE);
 await assert.rejects(syncCompactBoard(d,session,{id:crypto.randomUUID(),revision:1,delta:difference(board(),huge(board()))}),e=>e.status===413);
 await assert.rejects(writeSharedBoard(d,session,JSON.stringify(huge(board())),1),e=>e.status===413);
 assert.deepEqual(d.sql.prepare('SELECT data,revision FROM boards').get(),before);
 assert.equal(d.sql.prepare('SELECT count(*) n FROM board_operations').get().n,0);
});

test('client refuses an oversized edit before queueing it and keeps syncing smaller edits',async()=>{
 const d=seeded();const store=new MemoryStore();
 const net={async read(){const r=d.sql.prepare('SELECT data,revision FROM boards').get();return {session,data:JSON.parse(r.data),revision:r.revision}},async send(o,s){return {...await syncBoard(d,s,o),session:s}}};
 const c=new OfflineController(store,net,board);await c.start();
 assert.equal(c.update(huge(c.state.board)),false);
 assert.equal(c.state.tooLarge,true);assert.equal(c.state.pending,0);assert.equal(syncNotice(c.state).message,BOARD_TOO_LARGE);
 assert.equal(c.update(edit(c.state.board,v=>v.notes[1].tasks[0].text='small')),true);await settle();await c.sync();
 assert.equal(c.state.tooLarge,false);assert.equal(c.state.pending,0);assert.equal(syncNotice(c.state),null);
 assert.equal(JSON.parse(d.sql.prepare('SELECT data FROM boards').get().data).notes[1].tasks[0].text,'small');c.stop();
});
