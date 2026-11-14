// Roles: the owner (superadmin) and admins see and edit every cloud and manage people;
// members see and edit only the clouds granted to them (plus clouds they create).
export type Role='member'|'admin'|'superadmin';
export type MemberRole=Exclude<Role,'superadmin'>;
export type Identity={userId:string;email:string;displayName:string};
export type Session={role:Role;userId:string;email:string;name:string;boardId:string};
export const roleNames:Record<Role,string>={member:'Участник',admin:'Администратор',superadmin:'Суперадминистратор'};
export const canWrite=(role:Role|null)=>role==='member'||role==='admin'||role==='superadmin';
export const canAdmin=(role:Role|null)=>role==='admin'||role==='superadmin';
/** Admins and the owner see the whole board; members see only granted clouds. */
export const seesAllClouds=(role:Role|null)=>canAdmin(role);
/** Rows written before per-cloud access used 'viewer' / 'editor'; both are members now. */
export function normalizeRole(role:string):Role|null{
 if(role==='viewer'||role==='editor')return 'member';
 return role==='member'||role==='admin'||role==='superadmin'?role:null;
}
export function canManage(actor:Role,target:Role|null,next:Role){
 if(target==='superadmin'||next==='superadmin')return false;
 return actor==='superadmin'||actor==='admin'&&target!=='admin'&&next!=='admin';
}
export const normalizeEmail=(email:string)=>email.trim().toLowerCase();
