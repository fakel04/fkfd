import {env} from 'cloudflare:workers';
import {requireSession,checkOrigin,apiError} from '../../../../server-access';
import {AccessError} from '../../../../access-store';
import {canWrite} from '../../../../access-model';
import {materialInput,fileMaterialInput,MAX_FILE_BYTES} from '../../../../task-materials-model';
import {readMaterialBody} from '../../../../task-materials-request';
import {listMaterials,createMaterial,uploadMaterial} from '../../../../task-materials-store';
type Context={params:Promise<{taskId:string}>};

export async function GET(_request:Request,{params}:Context){
 try{const session=await requireSession();const {taskId}=await params;return Response.json({items:await listMaterials(env.DB!,session,taskId),uploadsEnabled:!!env.BUCKET},{headers:{'Cache-Control':'private, no-store'}})}catch(error){return apiError(error)}
}
export async function POST(request:Request,{params}:Context){
 try{
  const session=await requireSession();checkOrigin(request);if(!canWrite(session.role))throw new AccessError('Изменять материалы нельзя.');
  const {taskId}=await params;
  const multipart=request.headers.get('content-type')?.startsWith('multipart/form-data');
  const limit=multipart?MAX_FILE_BYTES+100000:100000;
  const bytes=await readMaterialBody(request,limit);
  let item;
  if(multipart){
   const form=await new Request(request.url,{method:'POST',headers:{'Content-Type':request.headers.get('content-type')!},body:bytes}).formData();
   const file=form.get('file');if(!file||typeof file==='string')throw new AccessError('Выберите файл.',400);
   const metadata=fileMaterialInput.safeParse(Object.fromEntries(['title','text','source','sourceUrl'].map(key=>[key,form.get(key)??undefined])));
   if(!metadata.success)throw new AccessError(metadata.error.issues[0].message,400);
   item=await uploadMaterial(env.DB!,env.BUCKET,session,taskId,file,metadata.data);
  }else{
   let raw;try{raw=JSON.parse(new TextDecoder().decode(bytes))}catch{throw new AccessError('Некорректная запись.',400)}
   const parsed=materialInput.safeParse(raw);if(!parsed.success)throw new AccessError(parsed.error.issues[0].message,400);
   item=await createMaterial(env.DB!,session,taskId,parsed.data);
  }
  return Response.json({item},{status:201,headers:{'Cache-Control':'no-store'}});
 }catch(error){return apiError(error)}
}
