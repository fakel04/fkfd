import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {canAdmin,normalizeEmail} from '../../access-model';
import {AccessError,grantMember,changeMember,type WorkspaceRow,type MemberRow} from '../../access-store';
import {requireSession,apiError,checkOrigin} from '../../server-access';
export async function GET(){
 try{
  const session=await requireSession();if(!canAdmin(session.role))throw new AccessError('Раздел доступен только администраторам.');
  const workspace=await env.DB!.prepare('SELECT * FROM workspace WHERE id = ?').bind('main').first<WorkspaceRow>();
  const members=await env.DB!.prepare('SELECT * FROM members ORDER BY active DESC, created_at ASC').all<MemberRow>();
  return Response.json({session,owner:{email:workspace!.owner_email,name:workspace!.owner_name,role:'superadmin'},members:members.results.map(m=>({email:m.email,name:m.name,role:m.role,active:!!m.active,revision:m.revision,joined:!!m.user_id,self:m.user_id===session.userId}))},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return apiError(error)}
}
const memberInput=z.object({email:z.string().trim().email().max(254).transform(normalizeEmail),role:z.enum(['viewer','editor','admin'])});
export async function POST(request:Request){
 try{
  const session=await requireSession();checkOrigin(request);if(!canAdmin(session.role))throw new AccessError('Недостаточно прав.');
  const raw=await request.text();if(raw.length>3000)throw new AccessError('Слишком большой запрос.',413);
  let input;try{input=memberInput.parse(JSON.parse(raw))}catch{throw new AccessError('Проверьте email и роль.',400)}
  await grantMember(env.DB!,session,input.email,input.role);
  return Response.json({ok:true},{status:201,headers:{'Cache-Control':'no-store'}});
 }catch(error){return apiError(error)}
}
export async function PATCH(request:Request){
 try{
  const session=await requireSession();checkOrigin(request);if(!canAdmin(session.role))throw new AccessError('Недостаточно прав.');
  const raw=await request.text();if(raw.length>3000)throw new AccessError('Слишком большой запрос.',413);
  let input;try{input=memberInput.extend({active:z.boolean(),revision:z.number().int().positive()}).parse(JSON.parse(raw))}catch{throw new AccessError('Проверьте параметры доступа.',400)}
  await changeMember(env.DB!,session,input.email,input.role,input.active,input.revision);
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return apiError(error)}
}
