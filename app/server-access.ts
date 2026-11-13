import {env} from 'cloudflare:workers';
import {getChatGPTUser} from './chatgpt-auth';
import {AccessError,resolveSession} from './access-store';
import {parseLoginAliases} from './login-aliases';
export async function requireSession(){
 const user=await getChatGPTUser();
 if(!user)throw new AccessError('Войдите через ChatGPT.',401);
 if(!env.DB)throw new AccessError('Хранилище недоступно.',503);
 return resolveSession(env.DB,env.OBLAKA_OWNER_EMAIL,user,parseLoginAliases(env.OBLAKA_LOGIN_EMAIL_ALIASES));
}
export function apiError(error:unknown){
 const known=error instanceof AccessError;
 return Response.json({error:known?error.message:'Не удалось выполнить запрос.'},{status:known?error.status:500,headers:{'Cache-Control':'no-store'}});
}
export function checkOrigin(request:Request){
 const origin=request.headers.get('origin');
 if(origin&&origin!==new URL(request.url).origin)throw new AccessError('Недопустимый источник запроса.');
}
