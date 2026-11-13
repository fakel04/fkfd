import {canManage,normalizeEmail,type Identity,type Session,type MemberRole} from './access-model.ts';

export type WorkspaceRow={id:string;owner_user_id:string;owner_email:string;owner_name:string;created_at:string};
export type MemberRow={email:string;user_id:string|null;name:string;role:MemberRole;active:number;revision:number;created_at:string;updated_at:string;last_seen_at:string|null};
export class AccessError extends Error{status:number;constructor(message:string,status=403){super(message);this.status=status}}

/** The owner is bound only by a server-configured, verified sign-in email, never by the first visitor. */
export async function resolveSession(db:D1Database,ownerEmail:string|undefined,user:Identity,loginAliases:ReadonlyMap<string,string>=new Map()):Promise<Session>{
 let workspace=await db.prepare('SELECT * FROM workspace WHERE id = ?').bind('main').first<WorkspaceRow>();
 if(!workspace){
  if(!ownerEmail||normalizeEmail(user.email)!==normalizeEmail(ownerEmail))throw new AccessError('Сначала владелец должен открыть доску.',403);
  await db.prepare('INSERT OR IGNORE INTO workspace (id, owner_user_id, owner_email, owner_name, created_at) VALUES (?, ?, ?, ?, ?)').bind('main',user.userId,normalizeEmail(user.email),user.displayName,new Date().toISOString()).run();
  workspace=await db.prepare('SELECT * FROM workspace WHERE id = ?').bind('main').first<WorkspaceRow>();
 }
 if(!workspace)throw new AccessError('Не удалось открыть пространство.',503);
 if(user.userId===workspace.owner_user_id)return{role:'superadmin',userId:user.userId,email:user.email,name:user.displayName,boardId:workspace.owner_user_id};
 const email=normalizeEmail(user.email);
 // A previously bound subject always wins, including a revoked membership.
 let member=await db.prepare('SELECT * FROM members WHERE user_id = ?').bind(user.userId).first<MemberRow>();
 if(!member){
  // An explicit login-address membership takes precedence over an alias.
  member=await db.prepare('SELECT * FROM members WHERE email = ?').bind(email).first<MemberRow>();
  const alias=loginAliases.get(email);
  if(!member&&alias&&alias!==workspace.owner_email&&alias!==normalizeEmail(ownerEmail||'')){
   member=await db.prepare('SELECT * FROM members WHERE email = ?').bind(alias).first<MemberRow>();
  }
  if(member?.user_id&&member.user_id!==user.userId)throw new AccessError('Этот доступ уже привязан к другому аккаунту.');
 }
 if(!member||!member.active)throw new AccessError('Доступ к доске не выдан. Попросите администратора добавить ваш email.');
 if(!['viewer','editor','admin'].includes(member.role))throw new AccessError('Нет доступа.');
 if(!member.user_id){
  await db.prepare('UPDATE members SET user_id = ?, name = ?, last_seen_at = ? WHERE email = ? AND user_id IS NULL AND active = 1').bind(user.userId,user.displayName,new Date().toISOString(),member.email).run();
  member=await db.prepare('SELECT * FROM members WHERE user_id = ? AND active = 1').bind(user.userId).first<MemberRow>();
  if(!member)throw new AccessError('Доступ к доске изменён. Обновите страницу.');
 }
 return{role:member.role,userId:user.userId,email:user.email,name:user.displayName,boardId:workspace.owner_user_id};
}

export async function grantMember(db:D1Database,actor:Session,emailValue:string,role:MemberRole){
 const email=normalizeEmail(emailValue);
 const workspace=await db.prepare('SELECT * FROM workspace WHERE id = ?').bind('main').first<WorkspaceRow>();
 if(!workspace||email===workspace.owner_email||!canManage(actor.role,null,role))throw new AccessError('Недостаточно прав для этой роли.');
 const now=new Date().toISOString();
 const result=await db.prepare('INSERT INTO members (email, role, active, revision, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?) ON CONFLICT(email) DO NOTHING').bind(email,role,now,now).run();
 if(!result.meta.changes)throw new AccessError('Этот пользователь уже добавлен. Измените его права в списке.',409);
}

export async function changeMember(db:D1Database,actor:Session,email:string,role:MemberRole,active:boolean,revision:number){
 const current=await db.prepare('SELECT * FROM members WHERE email = ?').bind(email).first<MemberRow>();
 if(!current)throw new AccessError('Пользователь не найден.',404);
 if(current.user_id===actor.userId||current.user_id===actor.boardId||!canManage(actor.role,current.role,role))throw new AccessError('Вы не можете изменить права этого пользователя.');
 const result=await db.prepare('UPDATE members SET role = ?, active = ?, revision = revision + 1, updated_at = ? WHERE email = ? AND revision = ?').bind(role,active?1:0,new Date().toISOString(),email,revision).run();
 if(!result.meta.changes)throw new AccessError('Права уже изменены. Обновите список.',409);
}
