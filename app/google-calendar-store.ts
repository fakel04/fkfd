import {AccessError} from './access-store.ts';
import type {Session} from './access-model.ts';
import {CALENDAR_SCOPE,calendarZone} from './google-calendar-model.ts';
import {calendarHash,calendarChallenge,calendarRandom,sealCalendar,openCalendar} from './google-calendar-crypto.ts';
export type CalendarEnv={DB?:D1Database;GOOGLE_CALENDAR_CLIENT_ID?:string;GOOGLE_CALENDAR_CLIENT_SECRET?:string;GOOGLE_CALENDAR_TOKEN_KEY?:string};
export type Connection={board_id:string;owner_id:string;calendar_id:string|null;refresh_token:string|null;time_zone:string;enabled:number;last_sync:string|null;error:string|null;lease:string|null;lease_until:number};
export type Link={board_id:string;task_id:string;event_id:string;generation:number;baseline:string;pending:string|null;conflict:string|null;resolution:'local'|'remote'|null;checked_at:number};
export function calendarOwner(session:Session){if(session.role!=='superadmin')throw new AccessError('Календарь подключает только владелец доски.',403)}
export const calendarReady=(env:CalendarEnv)=>!!(env.GOOGLE_CALENDAR_CLIENT_ID&&env.GOOGLE_CALENDAR_CLIENT_SECRET&&env.GOOGLE_CALENDAR_TOKEN_KEY);
export function calendarConfig(env:CalendarEnv){if(!env.DB||!calendarReady(env))throw new AccessError('Сначала настройте Google OAuth для календаря. Инструкция есть в разделе подключения.',503);return {db:env.DB,clientId:env.GOOGLE_CALENDAR_CLIENT_ID!,clientSecret:env.GOOGLE_CALENDAR_CLIENT_SECRET!,key:env.GOOGLE_CALENDAR_TOKEN_KEY!}}
export const connectionFor=(db:D1Database,boardId:string)=>db.prepare('SELECT * FROM calendar_connections WHERE board_id=?').bind(boardId).first<Connection>();
export class GoogleCalendarError extends Error{status:number;constructor(status:number){super(status===401||status===403?'Google отклонил доступ. Подключите календарь заново.':status===429?'Google временно ограничил запросы. Повторим позже.':'Календарь Google временно недоступен. Повторим позже.');this.status=status}}
export async function googleJson(path:string,accessToken:string,init:RequestInit={},fetchImpl:typeof fetch=fetch){
 const response=await fetchImpl('https://www.googleapis.com/calendar/v3'+path,{...init,headers:{'Authorization':'Bearer '+accessToken,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new GoogleCalendarError(response.status);return response.status===204?null:response.json();
}
async function oauthToken(env:CalendarEnv,params:Record<string,string>,fetchImpl:typeof fetch){
 const config=calendarConfig(env);const response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({...params,client_id:config.clientId,client_secret:config.clientSecret}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new AccessError('Google не подтвердил подключение. Подключите календарь заново.',502);
 const body=await response.json() as {access_token?:string;refresh_token?:string;scope?:string};
 if(!body.access_token)throw new AccessError('Google не выдал доступ к календарю.',502);return body;
}
export async function beginCalendar(env:CalendarEnv,session:Session,origin:string,zone:unknown){
 calendarOwner(session);const {db,key,clientId}=calendarConfig(env);let timeZone:string;try{timeZone=calendarZone(zone)}catch{throw new AccessError('Проверьте часовой пояс устройства.',400)}
 const state=calendarRandom(),hash=await calendarHash(state),verifier=calendarRandom(),redirectUri=origin+'/api/calendar/callback';
 await db.prepare('DELETE FROM calendar_oauth WHERE expires_at<? OR (board_id=? AND owner_id=?)').bind(Date.now(),session.boardId,session.userId).run();
 await db.prepare('INSERT INTO calendar_oauth (state_hash,board_id,owner_id,verifier,redirect_uri,time_zone,expires_at) VALUES (?,?,?,?,?,?,?)').bind(hash,session.boardId,session.userId,await sealCalendar(verifier,key,'oauth:'+hash),redirectUri,timeZone,Date.now()+600000).run();
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:CALENDAR_SCOPE,access_type:'offline',prompt:'consent',state,code_challenge:await calendarChallenge(verifier),code_challenge_method:'S256'}).toString();
 return {url:url.toString(),state};
}
export async function finishCalendar(env:CalendarEnv,session:Session,url:URL,cookieState:string,fetchImpl:typeof fetch=fetch){
 calendarOwner(session);const {db,key}=calendarConfig(env);const state=url.searchParams.get('state')||'';
 if(!state||state!==cookieState||state.length!==64)throw new AccessError('Подключение устарело. Начните заново.',400);
 const hash=await calendarHash(state);
 const saved=await db.prepare('DELETE FROM calendar_oauth WHERE state_hash=? AND board_id=? AND owner_id=? AND expires_at>? RETURNING *').bind(hash,session.boardId,session.userId,Date.now()).first<{verifier:string;redirect_uri:string;time_zone:string}>();
 if(!saved||saved.redirect_uri!==url.origin+'/api/calendar/callback')throw new AccessError('Подключение устарело. Начните заново.',400);
 if(url.searchParams.has('error'))throw new AccessError('Подключение Google отменено.',400);
 const code=url.searchParams.get('code');if(!code||code.length>4096)throw new AccessError('Google не передал код подключения.',400);
 const token=await oauthToken(env,{grant_type:'authorization_code',code,redirect_uri:saved.redirect_uri,code_verifier:await openCalendar(saved.verifier,key,'oauth:'+hash)},fetchImpl);
 if(!token.scope?.split(' ').includes(CALENDAR_SCOPE)||!token.refresh_token)throw new AccessError('Google не выдал постоянный доступ. Подключите календарь заново и разрешите доступ.',400);
 const existing=await connectionFor(db,session.boardId);let calendarId=existing?.calendar_id;
 if(existing&&existing.owner_id!==session.userId)throw new AccessError('Изменился владелец подключения.',403);
 if(calendarId){
  // Never reuse the old calendar with a different Google account.
  await googleJson('/calendars/'+encodeURIComponent(calendarId),token.access_token!,{},fetchImpl);
 }else{
  const calendar=await googleJson('/calendars',token.access_token!,{method:'POST',body:JSON.stringify({summary:'Облака',description:'Дела из приложения «Облака».',timeZone:saved.time_zone})},fetchImpl) as {id:string};calendarId=calendar.id;
 }
 if(!calendarId)throw new AccessError('Не удалось создать отдельный календарь.',502);
 const encrypted=await sealCalendar(token.refresh_token,key,'refresh:'+session.boardId);
 await db.prepare('INSERT INTO calendar_connections (board_id,owner_id,calendar_id,refresh_token,time_zone,enabled) VALUES (?,?,?,?,?,1) ON CONFLICT(board_id) DO UPDATE SET calendar_id=excluded.calendar_id,refresh_token=excluded.refresh_token,time_zone=excluded.time_zone,enabled=1,error=NULL,lease=NULL,lease_until=0').bind(session.boardId,session.userId,calendarId,encrypted,saved.time_zone).run();
}
export async function calendarAccess(env:CalendarEnv,connection:Connection,fetchImpl:typeof fetch=fetch){
 const {key}=calendarConfig(env);if(!connection.refresh_token)throw new AccessError('Подключите календарь заново.',400);
 const token=await oauthToken(env,{grant_type:'refresh_token',refresh_token:await openCalendar(connection.refresh_token,key,'refresh:'+connection.board_id)},fetchImpl);return token.access_token!;
}
export async function disconnectCalendar(env:CalendarEnv,session:Session,fetchImpl:typeof fetch=fetch){
 calendarOwner(session);if(!env.DB)throw new AccessError('Хранилище недоступно.',503);const db=env.DB,key=env.GOOGLE_CALENDAR_TOKEN_KEY;const connection=await connectionFor(db,session.boardId);
 if(connection&&connection.owner_id!==session.userId)throw new AccessError('Изменился владелец подключения.',403);
 // Invalidate the lease before revocation; an in-flight run can no longer commit.
 await db.prepare('UPDATE calendar_connections SET enabled=0,refresh_token=NULL,lease=NULL,lease_until=0,error=NULL WHERE board_id=? AND owner_id=?').bind(session.boardId,session.userId).run();
 await db.prepare('DELETE FROM calendar_oauth WHERE board_id=?').bind(session.boardId).run();
 if(connection?.refresh_token&&key){try{await fetchImpl('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:await openCalendar(connection.refresh_token,key,'refresh:'+session.boardId)}),signal:AbortSignal.timeout(15000)})}catch{/* Local disconnect is effective even when Google is offline. */}}
}
export async function calendarStatus(env:CalendarEnv,session:Session){
 calendarOwner(session);if(!env.DB)throw new AccessError('Хранилище недоступно.',503);const row=await connectionFor(env.DB,session.boardId);
 const conflicts=await env.DB.prepare('SELECT task_id,conflict FROM calendar_links WHERE board_id=? AND conflict IS NOT NULL ORDER BY checked_at LIMIT 50').bind(session.boardId).all<{task_id:string;conflict:string}>();
 const count=await env.DB.prepare('SELECT COUNT(*) AS count FROM calendar_links WHERE board_id=? AND conflict IS NOT NULL').bind(session.boardId).first<{count:number}>();
 return {configured:calendarReady(env),connected:!!row?.enabled,calendarId:row?.calendar_id??null,timeZone:row?.time_zone??null,lastSync:row?.last_sync??null,error:row?.error??null,running:!!row?.lease&&row.lease_until>Date.now(),conflictCount:count?.count??0,conflicts:conflicts.results.map(item=>({taskId:item.task_id,...JSON.parse(item.conflict)}))};
}
export async function resolveCalendar(env:CalendarEnv,session:Session,taskId:unknown,resolution:unknown){
 calendarOwner(session);const {db}=calendarConfig(env);const connection=await connectionFor(db,session.boardId);if(connection?.lease&&connection.lease_until>Date.now())throw new AccessError('Дождитесь окончания синхронизации и выберите версию.',409);if(typeof taskId!=='string'||taskId.length>100||!['local','remote'].includes(String(resolution)))throw new AccessError('Неверный выбор версии.',400);
 await db.prepare('UPDATE calendar_links SET resolution=?,checked_at=0 WHERE board_id=? AND task_id=? AND conflict IS NOT NULL').bind(resolution,session.boardId,taskId).run();
}
