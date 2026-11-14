import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {materialInput,materialUrl,MAX_FILE_BYTES} from '../app/task-materials-model.ts';
import {createMaterial,listMaterials,updateMaterial,deleteMaterial,uploadMaterial,downloadMaterial,tasksWithFiles} from '../app/task-materials-store.ts';
import {readMaterialBody} from '../app/task-materials-request.ts';
import {ensureMaterialsBucket} from '../scripts/cloudflare/materials-bucket.mjs';

function setup(){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 const prepare=query=>{let args=[];const stmt={bind(...values){args=values;return stmt},async first(){return sql.prepare(query).get(...args)??null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}}}};return stmt};
 const db={sql,prepare};
 const note=(id,tasks)=>({id,title:id,text:'',tasks,color:'white',category:'',pinned:false,archived:false,deleted:false,created:'2026'});
 const board={categories:[],notes:[note('visible',[{id:'task',text:'Дело',done:false}]),note('hidden',[{id:'secret-task',text:'Секрет',done:false}]),note('__focus_tasks__',[{id:'focused',text:'Фокус',done:false,origin:{noteId:'visible',title:'Видимое',color:'white',category:'',index:0}}])]};
 sql.prepare('INSERT INTO boards VALUES (?,?,?,?)').run('owner',JSON.stringify(board),1,'now');
 sql.prepare('INSERT INTO members (email,user_id,role,active,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('member@test','member','member',1,'now','now');
 sql.prepare('INSERT INTO cloud_access VALUES (?,?,?)').run('member@test','visible','now');
 const owner={role:'superadmin',userId:'owner',boardId:'owner',email:'owner@test',name:'Владелец'};
 const member={...owner,role:'member',userId:'member',email:'member@test',name:'Участник'};
 const objects=new Map();const bucket={async put(key,stream){objects.set(key,new Uint8Array(await new Response(stream).arrayBuffer()))},async get(key){return objects.has(key)?{body:objects.get(key)}:null},async delete(key){objects.delete(key)}};
 return {sql,db,board,owner,member,bucket,objects};
}
const summary=(extra={})=>materialInput.parse({kind:'summary',text:'Саммари: обсудили план',source:'gpt',sourceUrl:'https://chatgpt.com/c/chat',...extra});

test('comments CRUD preserves the main board and rejects stale updates and unsafe artifact links',async()=>{
 const {db,owner,member}=setup();const before=db.sql.prepare('SELECT data FROM boards').get().data;
 const item=await createMaterial(db,member,'task',summary());assert.equal(item.authorName,'Участник');assert.equal(item.source,'gpt');assert.ok(item.createdAt);
 assert.equal((await listMaterials(db,owner,'task')).length,1);
 const updated=await updateMaterial(db,owner,'task',item.id,1,summary({text:'Обновлённое саммари',source:'claude',sourceUrl:'https://claude.ai/chat/chat'}));
 assert.equal(updated.revision,2);assert.equal(updated.text,'Обновлённое саммари');
 await assert.rejects(()=>updateMaterial(db,owner,'task',item.id,1,summary()),e=>e.status===409);
 await assert.rejects(()=>deleteMaterial(db,undefined,owner,'task',item.id,1),e=>e.status===409);
 await deleteMaterial(db,undefined,owner,'task',item.id,2);assert.deepEqual(await listMaterials(db,owner,'task'),[]);
 assert.equal(db.sql.prepare('SELECT data FROM boards').get().data,before);
 for(const url of ['javascript:alert(1)','data:text/html,hello','http://example.com','https://user:pass@example.com'])assert.throws(()=>materialUrl(url));
 assert.equal(materialInput.safeParse({kind:'summary',text:'  '}).success,false);
 assert.equal(materialInput.safeParse({kind:'link',url:''}).success,false);
 assert.equal(materialInput.safeParse({kind:'summary',text:'a'.repeat(20001)}).success,false);
});

test('materials use current cloud access including focus tasks, transfers and revoked access',async()=>{
 const {db,sql,board,owner,member,bucket}=setup();
 const secret=await createMaterial(db,owner,'secret-task',summary());
 for(const work of [()=>listMaterials(db,member,'secret-task'),()=>createMaterial(db,member,'secret-task',summary()),()=>updateMaterial(db,member,'secret-task',secret.id,1,summary()),()=>deleteMaterial(db,bucket,member,'secret-task',secret.id,1),()=>downloadMaterial(db,bucket,member,'secret-task',secret.id)])await assert.rejects(work,e=>e.status===404);
 await createMaterial(db,member,'focused',summary());assert.equal((await listMaterials(db,member,'focused')).length,1);
 const item=await createMaterial(db,member,'task',summary());
 const moved=board.notes[0].tasks.pop();board.notes[1].tasks.push(moved);sql.prepare('UPDATE boards SET data=?').run(JSON.stringify(board));
 await assert.rejects(()=>listMaterials(db,member,'task'),e=>e.status===404);
 assert.equal((await listMaterials(db,owner,'task'))[0].id,item.id);
 sql.prepare('DELETE FROM cloud_access').run();await assert.rejects(()=>listMaterials(db,member,'focused'),e=>e.status===404);
 await assert.rejects(()=>listMaterials(db,{...owner,boardId:'other-board'},'secret-task'),e=>e.status===404);
});

test('private attachments download safely, enforce size, and clean up storage after removal or failed metadata write',async()=>{
 const {db,owner,bucket,objects}=setup();
 const item=await uploadMaterial(db,bucket,owner,'task',new File(['<html>artifact</html>'],'test.html',{type:'text/html'}),{text:'Код из чата',title:'Артефакт',source:'claude',sourceUrl:'https://claude.ai/chat/artifact'});
 assert.equal(item.kind,'file');assert.equal(item.source,'claude');assert.equal(item.sourceUrl,'https://claude.ai/chat/artifact');assert.equal(objects.size,1);assert.equal('file_key' in item,false);
 const response=await downloadMaterial(db,bucket,owner,'task',item.id);
 assert.equal(await response.text(),'<html>artifact</html>');assert.equal(response.headers.get('content-type'),'application/octet-stream');
 assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-security-policy'),/sandbox/);
 await assert.rejects(()=>uploadMaterial(db,undefined,owner,'task',new File(['file'],'a.txt')),e=>e.status===503);
 await assert.rejects(()=>uploadMaterial(db,bucket,owner,'task',new File([],'empty')),e=>e.status===413);
 await assert.rejects(()=>uploadMaterial(db,bucket,owner,'task',new File([new Uint8Array(MAX_FILE_BYTES+1)],'large')),e=>e.status===413);
 await deleteMaterial(db,bucket,owner,'task',item.id,1);assert.equal(objects.size,0);
 await assert.rejects(()=>downloadMaterial(db,bucket,owner,'task',item.id),e=>e.status===404);
 db.sql.exec("CREATE TRIGGER fail_material BEFORE INSERT ON task_materials BEGIN SELECT RAISE(ABORT, 'fail'); END");
 await assert.rejects(()=>uploadMaterial(db,bucket,owner,'task',new File(['file'],'a.txt')));assert.equal(objects.size,0);
});

test('bounded requests reject oversized streamed bodies even without Content-Length',async()=>{
 const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(6));controller.enqueue(new Uint8Array(6));controller.close()}});
 const request=new Request('https://example.com',{method:'POST',body,duplex:'half'});
 await assert.rejects(()=>readMaterialBody(request,10),e=>e.status===413);
 assert.equal(new TextDecoder().decode(await readMaterialBody(new Request('https://example.com',{method:'POST',body:'hello'}),10)),'hello');
});

test('R2 provisioning reuses an existing bucket, creates a missing one, and fails clearly on missing permissions',async()=>{
 const options={accountId:'account',token:'test-token',name:'oblaka-materials'};const calls=[];
 assert.equal(await ensureMaterialsBucket({...options,fetchImpl:async()=>new Response('{}')}),'oblaka-materials');
 await ensureMaterialsBucket({...options,fetchImpl:async(url,init)=>{calls.push({url,...init});return new Response('{}',{status:calls.length===1?404:200})}});
 assert.equal(calls.length,2);assert.equal(calls[1].method,'POST');assert.deepEqual(JSON.parse(calls[1].body),{name:'oblaka-materials'});
 await assert.rejects(()=>ensureMaterialsBucket({...options,fetchImpl:async()=>new Response('{}',{status:403})}),/Workers R2 Storage/);
});

test('the paperclip list names only visible tasks with a file, never comments-only or hidden ones',async()=>{
 const {db,owner,member,bucket}=setup();
 const file=name=>new File(['x'],name);
 await uploadMaterial(db,bucket,owner,'task',file('a.txt'));
 await uploadMaterial(db,bucket,owner,'secret-task',file('b.txt'));
 await createMaterial(db,owner,'focused',summary());
 assert.deepEqual((await tasksWithFiles(db,owner)).sort(),['secret-task','task']);
 assert.deepEqual(await tasksWithFiles(db,member),['task']);
 assert.deepEqual(await tasksWithFiles(db,{...owner,boardId:'other-board'}),[]);
});
