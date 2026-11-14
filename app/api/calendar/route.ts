import {env} from 'cloudflare:workers';
import {requireSession,checkOrigin,apiError} from '../../server-access';
import {AccessError} from '../../access-store';
import {beginCalendar,calendarStatus,disconnectCalendar,resolveCalendar} from '../../google-calendar-store';
import {syncCalendar} from '../../google-calendar-sync';
const json=(body:unknown)=>Response.json(body,{headers:{'Cache-Control':'no-store'}});
export async function GET(){try{return json(await calendarStatus(env,await requireSession()))}catch(error){return apiError(error)}}
export async function POST(request:Request){
 try{
  const session=await requireSession();checkOrigin(request);const raw=await request.text();if(raw.length>2000)throw new AccessError('Слишком большой запрос.',413);
  let body;try{body=JSON.parse(raw)}catch{throw new AccessError('Неверный запрос.',400)}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new AccessError('Неверный запрос.',400);
  if(body.action==='connect'){
   const result=await beginCalendar(env,session,new URL(request.url).origin,body.timeZone);
   return Response.json({url:result.url},{headers:{'Cache-Control':'no-store','Set-Cookie':'oblaka_calendar_oauth='+result.state+'; Path=/api/calendar; HttpOnly; SameSite=Lax; Max-Age=600'+(new URL(request.url).protocol==='https:'?'; Secure':'')}});
  }
  if(body.action==='sync')return json(await syncCalendar(env,session));
  if(body.action==='disconnect'){await disconnectCalendar(env,session);return json({ok:true})}
  if(body.action==='resolve'){await resolveCalendar(env,session,body.taskId,body.resolution);return json({ok:true})}
  throw new AccessError('Неизвестное действие.',400);
 }catch(error){return apiError(error)}
}
