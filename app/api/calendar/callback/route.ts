import {env} from 'cloudflare:workers';
import {requireSession} from '../../../server-access';
import {finishCalendar} from '../../../google-calendar-store';
import {AccessError} from '../../../access-store';
export async function GET(request:Request){
 const url=new URL(request.url);let result='connected';
 try{
  const state=request.headers.get('cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith('oblaka_calendar_oauth='))?.slice('oblaka_calendar_oauth='.length)||'';
  await finishCalendar(env,await requireSession(),url,state);
 }catch(error){result=error instanceof AccessError?error.message:'Не удалось подключить календарь. Попробуйте ещё раз.'}
 // Never carry the authorization code, state or Google's error response into UI.
 const target=new URL('/admin',url.origin);target.searchParams.set('calendar',result);
 return new Response(null,{status:303,headers:{Location:target.toString(),'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':'oblaka_calendar_oauth=; Path=/api/calendar; HttpOnly; SameSite=Lax; Max-Age=0'+(url.protocol==='https:'?'; Secure':'')}});
}
