export type Role='viewer'|'editor'|'admin'|'superadmin';
export type MemberRole=Exclude<Role,'superadmin'>;
export type Identity={userId:string;email:string;displayName:string};
export type Session={role:Role;userId:string;email:string;name:string;boardId:string};
export const roleNames:Record<Role,string>={viewer:'Просмотр',editor:'Редактор',admin:'Администратор',superadmin:'Суперадминистратор'};
export const canWrite=(role:Role|null)=>role==='editor'||role==='admin'||role==='superadmin';
export const canAdmin=(role:Role|null)=>role==='admin'||role==='superadmin';
export function canManage(actor:Role,target:Role|null,next:Role){
 if(target==='superadmin'||next==='superadmin')return false;
 return actor==='superadmin'||actor==='admin'&&target!=='admin'&&next!=='admin';
}
export const normalizeEmail=(email:string)=>email.trim().toLowerCase();
