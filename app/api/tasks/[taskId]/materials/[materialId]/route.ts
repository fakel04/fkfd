import {env} from 'cloudflare:workers';
import {requireSession,checkOrigin,apiError} from '../../../../../server-access';
import {AccessError} from '../../../../../access-store';
import {canWrite} from '../../../../../access-model';
import {materialInput} from '../../../../../task-materials-model';
import {readMaterialBody} from '../../../../../task-materials-request';
import {deleteMaterial,updateMaterial,downloadMaterial} from '../../../../../task-materials-store';
type Context={params:Promise<{taskId:string;materialId:string}>};

export async function GET(_request:Request,{params}:Context){
 try{const session=await requireSession();const {taskId,materialId}=await params;return await downloadMaterial(env.DB!,env.BUCKET,session,taskId,materialId)}catch(error){return apiError(error)}
}
export async function PATCH(request:Request,{params}:Context){
 try{
  const session=await requireSession();checkOrigin(request);if(!canWrite(session.role))throw new AccessError('Изменять материалы нельзя.');
  // A text entry is bounded independently from the main board.
  const raw=new TextDecoder().decode(await readMaterialBody(request,100000));
  let body;try{body=JSON.parse(raw)}catch{throw new AccessError('Некорректная запись.',400)}
  const parsed=materialInput.safeParse(body);if(!parsed.success)throw new AccessError(parsed.error.issues[0].message,400);
  if(!Number.isSafeInteger(body.revision)||body.revision<1)throw new AccessError('Обновите запись.',400);
  const {taskId,materialId}=await params;
  return Response.json({item:await updateMaterial(env.DB!,session,taskId,materialId,body.revision,parsed.data)},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return apiError(error)}
}
export async function DELETE(request:Request,{params}:Context){
 try{
  const session=await requireSession();checkOrigin(request);if(!canWrite(session.role))throw new AccessError('Изменять материалы нельзя.');
  const revision=Number(new URL(request.url).searchParams.get('revision'));if(!Number.isSafeInteger(revision)||revision<1)throw new AccessError('Обновите запись.',400);
  const {taskId,materialId}=await params;await deleteMaterial(env.DB!,env.BUCKET,session,taskId,materialId,revision);
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return apiError(error)}
}
