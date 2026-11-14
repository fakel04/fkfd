import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {canAdmin,normalizeEmail,normalizeRole} from '../../access-model';
import {AccessError,grantMember,changeMember,listCloudAccess,setCloudAccess,type WorkspaceRow,type MemberRow} from '../../access-store';
import {requireSession,apiError,checkOrigin} from '../../server-access';
import {readSharedBoard} from '../../board-store';
import {isFocusNote,type Board} from '../../board-model';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(){
 try{
  const session=await requireSession();if(!canAdmin(session.role))throw new AccessError('Раздел доступен только администраторам.');
  const workspace=await env.DB!.prepare('SELECT * FROM workspace WHERE id = ?').bind('main').first<WorkspaceRow>();
  const members=await env.DB!.prepare('SELECT * FROM members ORDER BY active DESC, created_at ASC').all<MemberRow>();
  const access=await listCloudAccess(env.DB!);
  const board=(await readSharedBoard(env.DB!,session)).data as Board|null;
  // Every cloud except the shared «Задачи» list, which everyone sees (filtered by access).
  const clouds=(board?.notes??[]).filter(note=>!isFocusNote(note)&&!note.deleted).map(note=>({id:note.id,title:note.title||'Без названия',archived:note.archived,color:note.color}));
  return json({session,owner:{email:workspace!.owner_email,name:workspace!.owner_name,role:'superadmin'},clouds,members:members.results.map(m=>({email:m.email,name:m.name,role:normalizeRole(m.role)??'member',active:!!m.active,revision:m.revision,joined:!!m.user_id,self:m.user_id===session.userId,clouds:access.get(m.email)??[]}))});
 }catch(error){return apiError(error)}
}
const memberInput=z.object({email:z.string().trim().email().max(254).transform(normalizeEmail),role:z.enum(['member','admin'])});
async function body<T>(request:Request,schema:z.ZodType<T>,message:string,limit=3000):Promise<T>{
 const raw=await request.text();if(raw.length>limit)throw new AccessError('Слишком большой запрос.',413);
 try{return schema.parse(JSON.parse(raw))}catch{throw new AccessError(message,400)}
}
export async function POST(request:Request){
 try{
  const session=await requireSession();checkOrigin(request);if(!canAdmin(session.role))throw new AccessError('Недостаточно прав.');
  const input=await body(request,memberInput,'Проверьте email и роль.');
  await grantMember(env.DB!,session,input.email,input.role);
  return json({ok:true},201);
 }catch(error){return apiError(error)}
}
export async function PATCH(request:Request){
 try{
  const session=await requireSession();checkOrigin(request);if(!canAdmin(session.role))throw new AccessError('Недостаточно прав.');
  const input=await body(request,memberInput.extend({active:z.boolean(),revision:z.number().int().positive()}),'Проверьте параметры доступа.');
  await changeMember(env.DB!,session,input.email,input.role,input.active,input.revision);
  return json({ok:true});
 }catch(error){return apiError(error)}
}
/** Replaces the clouds a member may see and edit. */
export async function PUT(request:Request){
 try{
  const session=await requireSession();checkOrigin(request);if(!canAdmin(session.role))throw new AccessError('Недостаточно прав.');
  const input=await body(request,z.object({email:z.string().trim().email().max(254),clouds:z.array(z.string().min(1).max(100)).max(2000)}),'Проверьте список облаков.',300000);
  await setCloudAccess(env.DB!,session,input.email,input.clouds);
  return json({ok:true});
 }catch(error){return apiError(error)}
}
