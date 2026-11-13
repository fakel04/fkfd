import { env } from 'cloudflare:workers';
import { boardSchema } from '../../board-model';
import { mergeTodoist, todoistImportSchema } from '../../todoist-import';

// Service imports are bound to one configured owner record and one explicit batch.
// The private Sites gate and this separate secret are both required; browser code never gets it.
function authorized(request:Request){
 return !!env.TODOIST_IMPORT_TOKEN && !!env.TODOIST_IMPORT_USER_ID && !!env.TODOIST_IMPORT_ID && request.headers.get('X-Import-Token')===env.TODOIST_IMPORT_TOKEN;
}
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
 if(!authorized(request))return response({error:'Unauthorized'},401);
 const row=await env.DB!.prepare('SELECT data, revision FROM boards WHERE user_id = ?').bind(env.TODOIST_IMPORT_USER_ID!).first<{data:string;revision:number}>();
 if(!row)return response({error:'Owner board not found'},404);
 return response({board:JSON.parse(row.data),revision:row.revision});
}
export async function POST(request:Request){
 if(!authorized(request))return response({error:'Unauthorized'},401);
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return response({error:'Invalid origin'},403);
 const text=await request.text();if(text.length>3000000)return response({error:'Too large'},413);
 let input;try{input=todoistImportSchema.parse(JSON.parse(text));}catch{return response({error:'Invalid import'},400)}
 if(input.importId!==env.TODOIST_IMPORT_ID)return response({error:'Unexpected batch'},403);
 for(let attempt=0;attempt<5;attempt++){
  const row=await env.DB!.prepare('SELECT data, revision FROM boards WHERE user_id = ?').bind(env.TODOIST_IMPORT_USER_ID!).first<{data:string;revision:number}>();
  if(!row)return response({error:'Owner board not found'},404);
  let merged;try{merged=mergeTodoist(boardSchema.parse(JSON.parse(row.data)),input,new Date().toISOString())}catch(e){return response({error:(e as Error).message},400)}
  if(merged.alreadyImported)return response({alreadyImported:true,receipt:merged.receipt,revision:row.revision});
  const data=JSON.stringify(merged.board);if(data.length>3000000)return response({error:'Board too large'},413);
  const result=await env.DB!.prepare('UPDATE boards SET data = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?').bind(data,merged.receipt.at,env.TODOIST_IMPORT_USER_ID!,row.revision).run();
  if(result.meta.changes)return response({alreadyImported:false,receipt:merged.receipt,revision:row.revision+1});
 }
 return response({error:'Board changed; retry the same import'},409);
}
