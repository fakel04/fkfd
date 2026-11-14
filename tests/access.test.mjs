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
 await grantMember(db,owner,' READER@EXAMPLE.COM ','member');const session=await resolveSession(db,ownerIdentity.email,reader);assert.equal(session.role,'member');assert.equal(session.boardId,owner.userId);
 await denied(resolveSession(db,ownerIdentity.email,{...reader,userId:'different-subject'}));
 await changeMember(db,owner,reader.email,'member',true,1);assert.equal((await resolveSession(db,ownerIdentity.email,reader)).role,'member');
 await changeMember(db,owner,reader.email,'member',false,2);await denied(resolveSession(db,ownerIdentity.email,reader));
});
test('owner role cannot be granted or changed; admins only manage viewers and editors',async()=>{
 const {db,owner}=await setup();await denied(grantMember(db,owner,owner.email,'member'));
 await grantMember(db,owner,'admin@example.com','admin');const admin=await resolveSession(db,ownerIdentity.email,guest('admin'));
 await grantMember(db,admin,'reader@example.com','member');
 await denied(grantMember(db,admin,'other-admin@example.com','admin'));
 await denied(changeMember(db,admin,'reader@example.com','admin',true,1));
 await denied(changeMember(db,admin,'admin@example.com','member',true,1));
 await changeMember(db,admin,'reader@example.com','member',true,1);
 await grantMember(db,owner,'other-admin@example.com','admin');await denied(changeMember(db,admin,'other-admin@example.com','member',false,1));
 await changeMember(db,owner,'other-admin@example.com','member',false,1);
});
test('viewers and editors cannot manage membership; stale role changes and duplicate grants do not overwrite',async()=>{
 const {db,owner}=await setup();await grantMember(db,owner,'reader@example.com','member');const viewer=await resolveSession(db,ownerIdentity.email,guest('reader'));
 for(const role of ['member','member']){assert.equal(canAdmin(role),false);await denied(grantMember(db,{...viewer,role},'new@example.com','member'));await denied(changeMember(db,{...viewer,role},'reader@example.com','member',true,1))}
 await denied(grantMember(db,owner,'reader@example.com','admin'),409);
 await changeMember(db,owner,'reader@example.com','member',true,1);
 await denied(changeMember(db,owner,'reader@example.com','member',false,1),409);
 assert.equal((await resolveSession(db,ownerIdentity.email,guest('reader'))).role,'member');
});
test('members read the owner board but cannot use the whole-board write; admins can; other personal records stay intact',async()=>{
 const {db,owner}=await setup();db.sql.prepare('INSERT INTO boards VALUES (?,?,?,?)').run(owner.userId,JSON.stringify({notes:['existing owner tasks']}),26,'old');
 db.sql.prepare('INSERT INTO boards VALUES (?,?,?,?)').run('reader',JSON.stringify({notes:['private old board']}),2,'old');
 await grantMember(db,owner,'reader@example.com','member');const member=await resolveSession(db,ownerIdentity.email,guest('reader'));
 assert.deepEqual(await readSharedBoard(db,member),{data:{notes:['existing owner tasks']},revision:26});
 assert.equal(canWrite(member.role),true);await denied(writeSharedBoard(db,member,'{}',26));
 await grantMember(db,owner,'admin@example.com','admin');const admin=await resolveSession(db,ownerIdentity.email,guest('admin'));
 assert.equal(await writeSharedBoard(db,admin,JSON.stringify({notes:['shared edit']}),26),27);
 assert.deepEqual((await readSharedBoard(db,owner)).data,{notes:['shared edit']});
 assert.deepEqual(JSON.parse(db.sql.prepare('SELECT data FROM boards WHERE user_id=?').get('reader').data),{notes:['private old board']});
});
test('members invited before per-cloud access (viewer / editor) become members',async()=>{
 const {db,owner}=await setup();
 for(const [id,role] of [['old-viewer','viewer'],['old-editor','editor']])db.sql.prepare("INSERT INTO members (email, role, active, revision, created_at, updated_at) VALUES (?, ?, 1, 1, 'x', 'x')").run(id+'@example.com',role);
 for(const id of ['old-viewer','old-editor'])assert.equal((await resolveSession(db,ownerIdentity.email,guest(id))).role,'member');
 const {cloudScope}=await import('../app/access-store.ts');
 assert.equal((await cloudScope(db,await resolveSession(db,ownerIdentity.email,guest('old-editor')))).size,0);
 assert.equal(await cloudScope(db,owner),null);
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
 await grantMember(db,owner,'contact@example.com','member');
 await denied(resolveSession(db,ownerIdentity.email,login));
 const session=await resolveSession(db,ownerIdentity.email,login,aliases);
 assert.equal(session.role,'member');assert.equal(session.email,login.email);assert.equal(session.boardId,owner.boardId);
 await denied(resolveSession(db,ownerIdentity.email,{...login,userId:'impostor'},aliases));
 // No dependency on the alias after the verified subject has been bound.
 assert.equal((await resolveSession(db,ownerIdentity.email,login)).role,'member');
 await changeMember(db,owner,'contact@example.com','member',false,1);
 await denied(resolveSession(db,ownerIdentity.email,login,aliases));
});
test('aliases do not bootstrap owners, revive disabled login grants or bypass stable subject revocation',async()=>{
 const login=guest('apple-user','relay@privaterelay.appleid.com');
 const ownerAlias=parseLoginAliases('{"relay@privaterelay.appleid.com":"owner@example.com"}');
 await denied(resolveSession(database(),ownerIdentity.email,login,ownerAlias));
 const {db,owner}=await setup();await denied(resolveSession(db,ownerIdentity.email,login,ownerAlias));
 const aliases=parseLoginAliases('{"relay@privaterelay.appleid.com":"contact@example.com"}');
 await grantMember(db,owner,'contact@example.com','admin');await grantMember(db,owner,login.email,'member');
 await changeMember(db,owner,login.email,'member',false,1);
 await denied(resolveSession(db,ownerIdentity.email,login,aliases));
 await changeMember(db,owner,login.email,'member',true,2);
 assert.equal((await resolveSession(db,ownerIdentity.email,login,aliases)).role,'member');
 await changeMember(db,owner,login.email,'member',false,3);
 await denied(resolveSession(db,ownerIdentity.email,{...login,email:'contact@example.com'},aliases));
 assert.throws(()=>parseLoginAliases('{broken'));
 assert.throws(()=>parseLoginAliases('{"x@example.com":true}'));
});
