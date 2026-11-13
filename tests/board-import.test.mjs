import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {parseBoardBackup,replaceSharedBoard} from '../app/board-import.ts';
import {MAX_BOARD_BYTES} from '../app/board-model.ts';

function db(){const sql=new DatabaseSync(':memory:');for(const n of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+n,'utf8'));
 return{sql,prepare(q){let args=[];const statement={bind(...v){args=v;return statement},async first(){return sql.prepare(q).get(...args)||null},async run(){return{meta:{changes:Number(sql.prepare(q).run(...args).changes)}}}};return statement}};}
const owner={role:'superadmin',userId:'access:owner',boardId:'access:owner',name:'o',email:'o@example.com'};
const note=(id,tasks=[])=>({id,title:id,text:'',tasks,color:'white',category:'',pinned:false,archived:false,deleted:false,created:'2026'});
const backup=(extra={})=>JSON.stringify({notes:[note('a',[{id:'t1',text:'one',done:false}])],categories:['Идеи'],recovery:{drafts:[],conflicts:[]},...extra},null,2);
const stored=d=>{const row=d.sql.prepare('SELECT data,revision FROM boards').get();return {data:JSON.parse(row.data),revision:row.revision}};

test('a downloaded backup is accepted without its recovery section and gains the focus list',()=>{
 const board=parseBoardBackup(backup());
 assert.equal(board.recovery,undefined);
 assert.deepEqual(board.notes.map(n=>n.id),['__focus_tasks__','a']);
});

test('broken, foreign or inconsistent files are refused with a clear message',()=>{
 assert.throws(()=>parseBoardBackup('{'),/не JSON/);
 assert.throws(()=>parseBoardBackup('{"hello":1}'),/не похож/);
 assert.throws(()=>parseBoardBackup(backup({notes:[note('a'),note('a')]})),/повреждена/);
});

test('the owner replaces an empty or existing board; others cannot',async()=>{
 const d=db();
 assert.equal(await replaceSharedBoard(d,owner,parseBoardBackup(backup())),1);
 assert.equal(stored(d).data.notes[1].tasks[0].text,'one');
 assert.equal(await replaceSharedBoard(d,owner,parseBoardBackup(backup({notes:[note('b')]}))),2);
 assert.deepEqual(stored(d).data.notes.map(n=>n.id),['__focus_tasks__','b']);
 for(const role of ['admin','editor','viewer'])await assert.rejects(replaceSharedBoard(d,{...owner,role},parseBoardBackup(backup())),e=>e.status===403);
 assert.equal(stored(d).revision,2);
});

test('an oversized board is refused before writing',async()=>{
 const d=db();const big=parseBoardBackup(backup({notes:Array.from({length:3},(_,n)=>note('n'+n,Array.from({length:150},(_,i)=>({id:n+'-'+i,text:'я'.repeat(4500),done:false}))))}));
 assert.ok(new TextEncoder().encode(JSON.stringify(big)).length>MAX_BOARD_BYTES);
 await assert.rejects(replaceSharedBoard(d,owner,big),e=>e.status===413);
 assert.equal(d.sql.prepare('SELECT count(*) n FROM boards').get().n,0);
});

