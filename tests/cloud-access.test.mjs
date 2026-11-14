import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {resolveSession,grantMember,setCloudAccess,cloudScope} from '../app/access-store.ts';
import {readBoardFor,readBoardSince} from '../app/board-store.ts';
import {syncBoard,syncCompactBoard} from '../app/sync-store.ts';
import {difference} from '../app/board-delta.ts';

function database(){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 const prepare=query=>{let args=[];const s={bind(...v){args=v;return s},async first(){return sql.prepare(query).get(...args)??null},async all(){return{results:sql.prepare(query).all(...args)}},async run(){return{meta:{changes:Number(sql.prepare(query).run(...args).changes)}}}};return s};
 return {sql,prepare,async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
}
const ownerIdentity={userId:'owner',email:'owner@example.com',displayName:'Owner'};
const guest=id=>({userId:id,email:id+'@example.com',displayName:id});
const task=(id,extra={})=>({id,text:id,done:false,...extra});
const note=(id,tasks=[],extra={})=>({id,title:id,text:'',color:'white',category:'',created:'2026',pinned:false,archived:false,deleted:false,tasks,...extra});
const origin=noteId=>({noteId,title:noteId,color:'white',category:'',index:0});
const fullBoard=()=>({categories:['Работа'],labels:['секрет','общий'],imports:[{id:'imp',at:'x',taskCount:1,noteCount:1,taskIds:['h1']}],notes:[
 note('__focus_tasks__',[task('fa',{focused:true,origin:origin('A'),labels:['общий']}),task('fh',{focused:true,origin:origin('H'),labels:['секрет']})],{kind:'focus',pinned:true}),
 note('A',[task('a1'),task('a2')]),
 note('H',[task('h1',{labels:['секрет']})],{title:'Скрытое'}),
 note('B',[task('b1')]),
]});
const ids=board=>board.notes.map(n=>n.id);
const stored=db=>JSON.parse(db.sql.prepare('SELECT data FROM boards').get().data);
async function setup(){
 const db=database();const owner=await resolveSession(db,ownerIdentity.email,ownerIdentity);
 db.sql.prepare('INSERT INTO boards VALUES (?,?,?,?)').run(owner.boardId,JSON.stringify(fullBoard()),1,'x');
 await grantMember(db,owner,'member@example.com','member');await grantMember(db,owner,'admin@example.com','admin');
 const member=await resolveSession(db,ownerIdentity.email,guest('member'));const admin=await resolveSession(db,ownerIdentity.email,guest('admin'));
 await setCloudAccess(db,owner,'member@example.com',['A','B']);
 return {db,owner,member,admin};
}
const op=(base,f)=>{const data=structuredClone(base);f(data);return {id:crypto.randomUUID(),base,data}};

test('a member sees only granted clouds and, in «Задачи», only tasks from those clouds',async()=>{
 const {db,owner,member,admin}=await setup();
 const view=(await readBoardFor(db,member)).data;
 assert.deepEqual(ids(view),['__focus_tasks__','A','B']);
 assert.deepEqual(view.notes[0].tasks.map(t=>t.id),['fa']);
 assert.equal(view.imports,undefined);assert.deepEqual(view.labels,['общий']);
 assert.equal(JSON.stringify(view).includes('Скрытое')||JSON.stringify(view).includes('секрет'),false);
 // No "unchanged" shortcut for members: access changes do not bump the board revision.
 assert.ok((await readBoardSince(db,member,1)).data);
 for(const who of [owner,admin])assert.deepEqual(ids((await readBoardFor(db,who)).data),['__focus_tasks__','A','H','B']);
});

test('a member edits granted clouds; hidden clouds and tasks are kept and cannot be changed, even by a forged request',async()=>{
 const {db,member}=await setup();
 const view=(await readBoardFor(db,member)).data;
 const result=await syncBoard(db,member,op(view,v=>{v.notes[1].tasks[0].text='изменено';v.notes.reverse()}));
 // The member reversed their three clouds; the hidden cloud keeps its slot.
 assert.deepEqual(ids(result.data),['B','A','__focus_tasks__']);
 let board=stored(db);
 assert.deepEqual(ids(board),['B','A','H','__focus_tasks__']);
 assert.equal(board.notes.find(n=>n.id==='A').tasks[0].text,'изменено');
 assert.deepEqual(board.notes.find(n=>n.id==='H').tasks.map(t=>t.id),['h1']);
 assert.deepEqual(board.notes.find(n=>n.id==='__focus_tasks__').tasks.map(t=>t.id).sort(),['fa','fh']);
 assert.equal(board.imports.length,1);assert.ok(board.labels.includes('секрет'));
 assert.equal(JSON.stringify(result.data).includes('Скрытое'),false);
 // Forged: hidden cloud and hidden tasks injected into base and data with changes.
 const full=stored(db);const forged=op(full,v=>{
  v.notes.find(n=>n.id==='H').title='взлом';v.notes.find(n=>n.id==='H').deleted=true;
  const [h1]=v.notes.find(n=>n.id==='H').tasks.splice(0,1);v.notes.find(n=>n.id==='A').tasks.push(h1);
  v.notes.find(n=>n.id==='__focus_tasks__').tasks.find(t=>t.id==='fh').text='взлом';
  v.imports=[];
 });
 await syncBoard(db,member,forged);
 board=stored(db);const H=board.notes.find(n=>n.id==='H');
 assert.equal(H.title,'Скрытое');assert.equal(H.deleted,false);assert.deepEqual(H.tasks.map(t=>t.id),['h1']);
 assert.equal(board.notes.find(n=>n.id==='A').tasks.some(t=>t.id==='h1'),false);
 assert.equal(board.notes.find(n=>n.id==='__focus_tasks__').tasks.find(t=>t.id==='fh').text,'fh');
 assert.equal(board.imports.length,1);
});

test('a cloud created by a member is granted to them atomically; revoking access hides it',async()=>{
 const {db,owner,member}=await setup();
 const view=(await readBoardFor(db,member)).data;
 const created=await syncBoard(db,member,op(view,v=>{v.notes.push(note('N',[task('n1')]))}));
 assert.ok(ids(created.data).includes('N'));
 assert.deepEqual([...await cloudScope(db,member)].sort(),['A','B','N']);
 assert.ok(ids((await readBoardFor(db,member)).data).includes('N'));
 // Moving a task into «Задачи» from a granted cloud keeps it visible to the member.
 const moved=await syncBoard(db,member,op((await readBoardFor(db,member)).data,v=>{const t=v.notes.find(n=>n.id==='N').tasks.pop();v.notes[0].tasks.push({...t,focused:true,origin:origin('N')})}));
 assert.deepEqual(moved.data.notes[0].tasks.map(t=>t.id).sort(),['fa','n1']);
 await setCloudAccess(db,owner,'member@example.com',['B']);
 const after=(await readBoardFor(db,member)).data;
 assert.deepEqual(ids(after),['__focus_tasks__','B']);assert.deepEqual(after.notes[0].tasks,[]);
 // An edit queued offline before revocation is dropped instead of blocking the queue.
 const stale=await syncBoard(db,member,op(view,v=>{v.notes.find(n=>n.id==='A').title='поздно'}));
 assert.equal(stored(db).notes.find(n=>n.id==='A').title,'A');assert.deepEqual(ids(stale.data),['__focus_tasks__','B']);
});

test('member deltas are never applied to the whole board: the client is asked to resend fully',async()=>{
 const {db,member,admin}=await setup();
 const view=(await readBoardFor(db,member)).data;const changed=structuredClone(view);changed.notes[1].title='x';
 const result=await syncCompactBoard(db,member,{id:crypto.randomUUID(),revision:1,delta:difference(view,changed)});
 assert.equal(result.rebase,true);assert.deepEqual(ids(result.data),['__focus_tasks__','A','B']);
 assert.equal(db.sql.prepare('SELECT revision FROM boards').get().revision,1);
 const full=(await readBoardFor(db,admin)).data;const edited=structuredClone(full);edited.notes[2].title='admin';
 assert.equal((await syncCompactBoard(db,admin,{id:crypto.randomUUID(),revision:1,delta:difference(full,edited)})).acknowledged,true);
});

test('only admins grant clouds, and only to members',async()=>{
 const {db,member,admin}=await setup();
 await assert.rejects(setCloudAccess(db,member,'member@example.com',['H']),e=>e.status===403);
 await assert.rejects(setCloudAccess(db,admin,'admin@example.com',['H']),e=>e.status===400);
 await setCloudAccess(db,admin,'member@example.com',['H']);
 assert.deepEqual([...await cloudScope(db,member)],['H']);
 assert.deepEqual(ids((await readBoardFor(db,member)).data),['__focus_tasks__','H']);
});
