import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {resolveSession,grantMember,changeMember} from '../app/access-store.ts';
import {readSharedBoard,writeSharedBoard} from '../app/board-store.ts';
import {canAdmin,canWrite} from '../app/access-model.ts';
import {parseLoginAliases} from '../app/login-aliases.ts';
const ownerIdentity={userId:'owner-site-id',email:'owner@example.com',displayName:'Owner'};
const guest=(id,email=id+'@example.com')=>({userId:id,email,displayName:id});
function database(){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 return {sql,prepare(query){const params=[];const statement={bind(...values){params.push(...values);return statement},async first(){return sql.prepare(query).get(...params)??null},async all(){return{results:sql.prepare(query).all(...params)}},async run(){const r=sql.prepare(query).run(...params);return{meta:{changes:Number(r.changes)}}}};return statement}};
}
const denied=(promise,status=403)=>assert.rejects(promise,e=>e.status===status);
async function setup(){const db=database();const owner=await resolveSession(db,ownerIdentity.email,ownerIdentity);return{db,owner}}
test('a random first visitor cannot become owner or create workspace; configured owner binds once',async()=>{
 const db=database();await denied(resolveSession(db,ownerIdentity.email,guest('stranger')));assert.equal(db.sql.prepare('SELECT count(*) AS n FROM workspace').get().n,0);
 await denied(resolveSession(db,undefined,ownerIdentity));
 const owner=await resolveSession(db,ownerIdentity.email,ownerIdentity);assert.equal(owner.role,'superadmin');
 await denied(resolveSession(db,ownerIdentity.email,{...ownerIdentity,userId:'impostor'}));
 assert.equal((await resolveSession(db,undefined,{...ownerIdentity,email:'changed@example.com'})).role,'superadmin');
});
test('invited email binds to one verified subject, role is refreshed and revocation takes effect',async()=>{
 const {db,owner}=await setup();const reader=guest('reader');await denied(resolveSession(db,ownerIdentity.email,reader));
 await grantMember(db,owner,' READER@EXAMPLE.COM ','viewer');const session=await resolveSession(db,ownerIdentity.email,reader);assert.equal(session.role,'viewer');assert.equal(session.boardId,owner.userId);
 await denied(resolveSession(db,ownerIdentity.email,{...reader,userId:'different-subject'}));
 await changeMember(db,owner,reader.email,'editor',true,1);assert.equal((await resolveSession(db,ownerIdentity.email,reader)).role,'editor');
 await changeMember(db,owner,reader.email,'editor',false,2);await denied(resolveSession(db,ownerIdentity.email,reader));
});
test('owner role cannot be granted or changed; admins only manage viewers and editors',async()=>{
 const {db,owner}=await setup();await denied(grantMember(db,owner,owner.email,'viewer'));
 await grantMember(db,owner,'admin@example.com','admin');const admin=await resolveSession(db,ownerIdentity.email,guest('admin'));
 await grantMember(db,admin,'reader@example.com','viewer');
 await denied(grantMember(db,admin,'other-admin@example.com','admin'));
 await denied(changeMember(db,admin,'reader@example.com','admin',true,1));
 await denied(changeMember(db,admin,'admin@example.com','viewer',true,1));
 await changeMember(db,admin,'reader@example.com','editor',true,1);
 await grantMember(db,owner,'other-admin@example.com','admin');await denied(changeMember(db,admin,'other-admin@example.com','viewer',false,1));
 await changeMember(db,owner,'other-admin@example.com','viewer',false,1);
});
test('viewers and editors cannot manage membership; stale role changes and duplicate grants do not overwrite',async()=>{
 const {db,owner}=await setup();await grantMember(db,owner,'reader@example.com','viewer');const viewer=await resolveSession(db,ownerIdentity.email,guest('reader'));
 for(const role of ['viewer','editor']){assert.equal(canAdmin(role),false);await denied(grantMember(db,{...viewer,role},'new@example.com','viewer'));await denied(changeMember(db,{...viewer,role},'reader@example.com','editor',true,1))}
 await denied(grantMember(db,owner,'reader@example.com','admin'),409);
 await changeMember(db,owner,'reader@example.com','editor',true,1);
 await denied(changeMember(db,owner,'reader@example.com','viewer',false,1),409);
 assert.equal((await resolveSession(db,ownerIdentity.email,guest('reader'))).role,'editor');
});
test('all granted users read the existing owner board, viewers cannot write, other personal records stay intact',async()=>{
 const {db,owner}=await setup();db.sql.prepare('INSERT INTO boards VALUES (?,?,?,?)').run(owner.userId,JSON.stringify({notes:['existing owner tasks']}),26,'old');
 db.sql.prepare('INSERT INTO boards VALUES (?,?,?,?)').run('reader',JSON.stringify({notes:['private old board']}),2,'old');
 await grantMember(db,owner,'reader@example.com','viewer');const viewer=await resolveSession(db,ownerIdentity.email,guest('reader'));
 assert.deepEqual(await readSharedBoard(db,viewer),{data:{notes:['existing owner tasks']},revision:26});
 assert.equal(canWrite(viewer.role),false);await denied(writeSharedBoard(db,viewer,'{}',26));
 await changeMember(db,owner,'reader@example.com','editor',true,1);const editor=await resolveSession(db,ownerIdentity.email,guest('reader'));
 assert.equal(await writeSharedBoard(db,editor,JSON.stringify({notes:['shared edit']}),26),27);
 assert.deepEqual((await readSharedBoard(db,owner)).data,{notes:['shared edit']});
 assert.deepEqual(JSON.parse(db.sql.prepare('SELECT data FROM boards WHERE user_id=?').get('reader').data),{notes:['private old board']});
});
test('stale shared-board writes conflict rather than erase another participant edit',async()=>{
 const {db,owner}=await setup();await writeSharedBoard(db,owner,'{"v":1}',0);await writeSharedBoard(db,owner,'{"v":2}',1);
 await denied(writeSharedBoard(db,owner,'{"v":3}',1),409);await denied(writeSharedBoard(db,owner,'{"v":0}',0),409);
 assert.deepEqual(await readSharedBoard(db,owner),{data:{v:2},revision:2});
 await denied(writeSharedBoard(db,{...owner,boardId:'missing'},'{}',5),409);
});
test('owner-configured login alias preserves existing member role, binds once and respects revocation',async()=>{
 const {db,owner}=await setup();
 const login=guest('apple-user','relay@privaterelay.appleid.com');
 const aliases=parseLoginAliases('{"relay@privaterelay.appleid.com":"contact@example.com"}');
 await grantMember(db,owner,'contact@example.com','editor');
 await denied(resolveSession(db,ownerIdentity.email,login));
 const session=await resolveSession(db,ownerIdentity.email,login,aliases);
 assert.equal(session.role,'editor');assert.equal(session.email,login.email);assert.equal(session.boardId,owner.boardId);
 await denied(resolveSession(db,ownerIdentity.email,{...login,userId:'impostor'},aliases));
 // No dependency on the alias after the verified subject has been bound.
 assert.equal((await resolveSession(db,ownerIdentity.email,login)).role,'editor');
 await changeMember(db,owner,'contact@example.com','editor',false,1);
 await denied(resolveSession(db,ownerIdentity.email,login,aliases));
});
test('aliases do not bootstrap owners, revive disabled login grants or bypass stable subject revocation',async()=>{
 const login=guest('apple-user','relay@privaterelay.appleid.com');
 const ownerAlias=parseLoginAliases('{"relay@privaterelay.appleid.com":"owner@example.com"}');
 await denied(resolveSession(database(),ownerIdentity.email,login,ownerAlias));
 const {db,owner}=await setup();await denied(resolveSession(db,ownerIdentity.email,login,ownerAlias));
 const aliases=parseLoginAliases('{"relay@privaterelay.appleid.com":"contact@example.com"}');
 await grantMember(db,owner,'contact@example.com','admin');await grantMember(db,owner,login.email,'viewer');
 await changeMember(db,owner,login.email,'viewer',false,1);
 await denied(resolveSession(db,ownerIdentity.email,login,aliases));
 await changeMember(db,owner,login.email,'viewer',true,2);
 assert.equal((await resolveSession(db,ownerIdentity.email,login,aliases)).role,'viewer');
 await changeMember(db,owner,login.email,'viewer',false,3);
 await denied(resolveSession(db,ownerIdentity.email,{...login,email:'contact@example.com'},aliases));
 assert.throws(()=>parseLoginAliases('{broken'));
 assert.throws(()=>parseLoginAliases('{"x@example.com":true}'));
});
