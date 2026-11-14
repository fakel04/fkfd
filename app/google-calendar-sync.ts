import type {Session} from './access-model.ts';
import {AccessError} from './access-store.ts';
import {boardSchema,boardBytes,MAX_BOARD_BYTES,BOARD_TOO_LARGE,taskDueDate,type Board,type Task} from './board-model.ts';
import {readBoardFor} from './board-store.ts';
import {calendarEvent,calendarTask,calendarTasks,mergeCalendar,eventBody,same,type CalendarValue,type GoogleEvent} from './google-calendar-model.ts';
import {calendarHash,calendarRandom} from './google-calendar-crypto.ts';
import {calendarConfig,calendarOwner,calendarAccess,connectionFor,googleJson,GoogleCalendarError,type CalendarEnv,type Link} from './google-calendar-store.ts';
const BATCH_SIZE=20;
const IMPORT_NOTE='__google_calendar__';
const supported=(event:GoogleEvent)=>!event.recurrence?.length&&!event.recurringEventId;
const parse=(value:string)=>JSON.parse(value) as CalendarValue|null;
const locate=(board:Board,id:string)=>board.notes.flatMap(note=>note.tasks.filter(task=>task.id===id).map(task=>({note,task})))[0];
/** A remote delete clears the date; comments, description and the task survive. */
export function applyCalendarValue(board:Board,taskId:string,value:CalendarValue|null):Board{
 const found=locate(board,taskId);
 if(!value){if(!found||!taskDueDate(found.task))return board;return {...board,notes:board.notes.map(note=>({...note,tasks:note.tasks.map(task=>task.id===taskId?{...task,dueDate:null}:task)}))}}
 const task:Task={...(found?.task??{id:taskId,text:'',done:false}),text:value.title,dueDate:value.when,done:value.done};
 if(found&&!found.note.deleted&&!found.note.archived)return {...board,notes:board.notes.map(note=>note.id===found.note.id?{...note,tasks:note.tasks.map(item=>item.id===taskId?task:item)}:note)};
 // Explicit remote conflict resolution may restore a removed/archived task into
 // the import cloud, preserving its ID and materials without duplicating it.
 let notes=board.notes.map(note=>({...note,tasks:note.tasks.filter(item=>item.id!==taskId)}));
 let target=notes.find(note=>note.id===IMPORT_NOTE&&!note.deleted&&!note.archived&&note.tasks.length<500);
 if(!target)target=notes.find(note=>note.id.startsWith(IMPORT_NOTE+'_')&&!note.deleted&&!note.archived&&note.tasks.length<500);
 if(!target){target={id:IMPORT_NOTE+'_'+crypto.randomUUID(),title:'Google Календарь',text:'',tasks:[],color:'blue',category:'',pinned:false,archived:false,deleted:false,created:new Date().toISOString()};notes.push(target)}
 return {...board,notes:notes.map(note=>note.id===target.id?{...note,tasks:[...note.tasks,task]}:note)};
}
async function allEvents(calendarId:string,access:string,fetchImpl:typeof fetch){
 const events=new Map<string,GoogleEvent>();let page='';
 for(let i=0;i<20;i++){
  const query=new URLSearchParams({maxResults:'500',showDeleted:'true',singleEvents:'false',...(page?{pageToken:page}:{})});
  const result=await googleJson('/calendars/'+encodeURIComponent(calendarId)+'/events?'+query,access,{},fetchImpl) as {items?:GoogleEvent[];nextPageToken?:string};
  for(const event of result.items??[])events.set(event.id,event);page=result.nextPageToken||'';if(!page)return events;
 }
 throw new AccessError('В календаре больше 10 000 событий. Синхронизация приостановлена.',413);
}
async function linksFor(db:D1Database,boardId:string){return (await db.prepare('SELECT * FROM calendar_links WHERE board_id=?').bind(boardId).all<Link>()).results}
export async function syncCalendar(env:CalendarEnv,session:Session,fetchImpl:typeof fetch=fetch){
 calendarOwner(session);const {db}=calendarConfig(env);let connection=await connectionFor(db,session.boardId);
 if(!connection?.enabled||!connection.calendar_id)throw new AccessError('Сначала подключите календарь.',400);
 if(connection.owner_id!==session.userId)throw new AccessError('Изменился владелец подключения.',403);
 const lease=calendarRandom(),started=Date.now();
 const locked=await db.prepare('UPDATE calendar_connections SET lease=?,lease_until=? WHERE board_id=? AND owner_id=? AND enabled=1 AND lease_until<?').bind(lease,started+120000,session.boardId,session.userId,started).run();
 if(!locked.meta.changes)throw new AccessError('Синхронизация уже идёт. Обновите состояние чуть позже.',409);
 async function guard(){const row=await db.prepare('SELECT lease,enabled,lease_until FROM calendar_connections WHERE board_id=?').bind(session.boardId).first<{lease:string;enabled:number;lease_until:number}>();if(!row?.enabled||row.lease!==lease||row.lease_until<Date.now())throw new AccessError('Подключение календаря изменилось. Повторите синхронизацию.',409)}
 let processed=0,pending=0,unsupported=0;
 try{
  connection=(await connectionFor(db,session.boardId))!;
  const access=await calendarAccess(env,connection,fetchImpl),calendarId=connection.calendar_id!;
  const events=await allEvents(calendarId,access,fetchImpl),boardHash=await calendarHash(session.boardId);await guard();
  const snapshot=await readBoardFor(db,session);if(!snapshot.data)throw new AccessError('Сначала создайте облако на доске.',400);
  const board=snapshot.data as Board,localValues=calendarTasks(board);
  let links=await linksFor(db,session.boardId);const knownTasks=new Set(links.map(link=>link.task_id)),knownEvents=new Set(links.map(link=>link.event_id));
  const insert=(taskId:string,eventId:string)=>db.prepare('INSERT OR IGNORE INTO calendar_links (board_id,task_id,event_id) VALUES (?,?,?)').bind(session.boardId,taskId,eventId);
  const additions:D1PreparedStatement[]=[];
  for(const [taskId,value] of localValues)if(value&&!knownTasks.has(taskId)){
   additions.push(insert(taskId,await calendarHash(calendarId+':'+taskId+':0')));knownTasks.add(taskId);
  }
  for(const event of events.values()){
   if(!supported(event)){unsupported++;continue}if(event.status==='cancelled'||knownEvents.has(event.id))continue;
   const owned=event.extendedProperties?.private?.oblakaBoard===boardHash?event.extendedProperties?.private?.oblakaTask:undefined;
   if(owned&&knownTasks.has(owned))continue;
   const taskId=owned&&owned.length<=100?owned:'gcal_'+await calendarHash(calendarId+':'+event.id);
   if(!knownTasks.has(taskId)){additions.push(insert(taskId,event.id));knownTasks.add(taskId)}
  }
  for(let i=0;i<additions.length;i+=50){await guard();await db.batch(additions.slice(i,i+50))}
  links=await linksFor(db,session.boardId);
  const dirty=(link:Link)=>{
   const event=events.get(link.event_id);if(event&&!supported(event))return false;
   try{return !!link.resolution||!same(localValues.get(link.task_id)??null,parse(link.baseline))||!same(event?calendarEvent(event):null,parse(link.baseline))}catch{return true}
  };
  // Compare all projections before selecting a bounded batch. Unchanged links do
  // not delay real changes on large boards; oldest pending changes go first.
  const work=links.filter(dirty).sort((a,b)=>Number(!!b.resolution)-Number(!!a.resolution)||a.checked_at-b.checked_at||a.task_id.localeCompare(b.task_id));
  pending=work.length;
  for(const link of work){
   if(processed>=BATCH_SIZE||Date.now()-started>45000)break;
   await guard();processed++;pending--;
   const event=events.get(link.event_id);
   const current=await readBoardFor(db,session);if(!current.data)break;
   const fresh=current.data as Board,local=calendarTasks(fresh).get(link.task_id)??null,remote=event?calendarEvent(event):null,base=link.pending&&event?parse(link.pending):parse(link.baseline);
   let merged=mergeCalendar(base,local,remote);
   if(link.resolution&&link.conflict){
    const previous=JSON.parse(link.conflict);
    if(same(previous.local,local)&&same(previous.remote,remote))merged={value:link.resolution==='local'?local:remote,conflict:false};
   }
   if(merged.conflict){
    await db.prepare('UPDATE calendar_links SET conflict=?,resolution=NULL,checked_at=? WHERE board_id=? AND task_id=?').bind(JSON.stringify({local,remote}),Date.now(),session.boardId,link.task_id).run();continue;
   }
   const value=merged.value;
   if(!same(value,remote)){
    const path='/calendars/'+encodeURIComponent(calendarId)+'/events';
    if(!value&&event&&event.status!=='cancelled'){
     await guard();try{await googleJson(path+'/'+encodeURIComponent(event.id)+'?sendUpdates=none',access,{method:'DELETE',headers:event.etag?{'If-Match':event.etag}:{}},fetchImpl)}catch(error){if(!(error instanceof GoogleCalendarError)||![404,410].includes(error.status))throw error}
    }else if(value){
     const projected=eventBody(value,event);
     const body={...projected,start:{date:null,dateTime:null,timeZone:null,...projected.start},end:{date:null,dateTime:null,timeZone:null,...projected.end},visibility:'private'};
     await guard();
     if(!event||event.status==='cancelled'){
      if(event?.status==='cancelled'){
       link.generation++;link.event_id=await calendarHash(calendarId+':'+link.task_id+':'+link.generation);
       await db.prepare('UPDATE calendar_links SET event_id=?,generation=? WHERE board_id=? AND task_id=?').bind(link.event_id,link.generation,session.boardId,link.task_id).run();
      }
      await db.prepare('UPDATE calendar_links SET pending=? WHERE board_id=? AND task_id=?').bind(JSON.stringify(value),session.boardId,link.task_id).run();
      try{await googleJson(path+'?sendUpdates=none',access,{method:'POST',body:JSON.stringify({...body,id:link.event_id,extendedProperties:{private:{oblakaBoard:boardHash,oblakaTask:link.task_id}}})},fetchImpl)}catch(error){
       // A previous insert may have succeeded before its response was lost. Read
       // on the next run instead of creating another event or claiming success.
       if(error instanceof GoogleCalendarError&&error.status===409){
        try{const existing=await googleJson(path+'/'+encodeURIComponent(link.event_id),access,{},fetchImpl) as GoogleEvent;
         if(existing.status==='cancelled'){link.generation++;await db.prepare('UPDATE calendar_links SET event_id=?,generation=? WHERE board_id=? AND task_id=?').bind(await calendarHash(calendarId+':'+link.task_id+':'+link.generation),link.generation,session.boardId,link.task_id).run()}
        }catch(readError){if(!(readError instanceof GoogleCalendarError)||![404,410].includes(readError.status))throw readError;link.generation++;await db.prepare('UPDATE calendar_links SET event_id=?,generation=? WHERE board_id=? AND task_id=?').bind(await calendarHash(calendarId+':'+link.task_id+':'+link.generation),link.generation,session.boardId,link.task_id).run()}
        pending++;break;
       }throw error;
      }
     }else await googleJson(path+'/'+encodeURIComponent(event.id)+'?sendUpdates=none',access,{method:'PATCH',headers:event.etag?{'If-Match':event.etag}:{},body:JSON.stringify(body)},fetchImpl);
    }
   }
   await guard();
   const baseline=JSON.stringify(value),now=Date.now();
   const saveLink=db.prepare('UPDATE calendar_links SET baseline=?,pending=NULL,conflict=NULL,resolution=NULL,checked_at=? WHERE board_id=? AND task_id=?');
   if(!same(value,local)){
    const changed=JSON.stringify(boardSchema.parse(applyCalendarValue(fresh,link.task_id,value)));
    if(boardBytes(changed)>MAX_BOARD_BYTES)throw new AccessError(BOARD_TOO_LARGE,413);
    // Persist the remote edit and its baseline in one D1 transaction. A board
    // revision race changes neither; a lost response cannot resurrect a task.
    const leaseClause='EXISTS (SELECT 1 FROM calendar_connections WHERE board_id=? AND enabled=1 AND lease=?)';
    const results=await db.batch([
     db.prepare('UPDATE calendar_links SET baseline=?,pending=NULL,conflict=NULL,resolution=NULL,checked_at=? WHERE board_id=? AND task_id=? AND EXISTS (SELECT 1 FROM boards WHERE user_id=? AND revision=?) AND '+leaseClause).bind(baseline,now,session.boardId,link.task_id,session.boardId,current.revision,session.boardId,lease),
     db.prepare('UPDATE boards SET data=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? AND '+leaseClause).bind(changed,new Date().toISOString(),session.boardId,current.revision,session.boardId,lease),
    ]);
    if(!results[1].meta.changes)throw new AccessError('Доска изменилась во время синхронизации. Повторим сверку.',409);
   }else await saveLink.bind(baseline,now,session.boardId,link.task_id).run();
  }
  const warning=unsupported?'Повторяющиеся события пока не синхронизируются: '+unsupported+'.':null;
  await db.prepare('UPDATE calendar_connections SET last_sync=?,error=? WHERE board_id=? AND lease=? AND enabled=1').bind(new Date().toISOString(),warning,session.boardId,lease).run();
  return {processed,pending,unsupported};
 }catch(error){
  const message=error instanceof AccessError||error instanceof GoogleCalendarError?error.message:'Не удалось связаться с календарём. Повторим при следующей синхронизации.';
  await db.prepare('UPDATE calendar_connections SET error=? WHERE board_id=? AND lease=?').bind(message,session.boardId,lease).run();
  throw new AccessError(message,error instanceof AccessError?error.status:502);
 }finally{await db.prepare('UPDATE calendar_connections SET lease=NULL,lease_until=0 WHERE board_id=? AND lease=?').bind(session.boardId,lease).run()}
}
export async function scheduledCalendar(env:CalendarEnv){
 if(!env.DB||!env.GOOGLE_CALENDAR_CLIENT_ID||!env.GOOGLE_CALENDAR_CLIENT_SECRET||!env.GOOGLE_CALENDAR_TOKEN_KEY)return;
 const owner=await env.DB.prepare('SELECT owner_user_id,owner_email,owner_name FROM workspace WHERE id=?').bind('main').first<{owner_user_id:string;owner_email:string;owner_name:string}>();if(!owner)return;
 const connection=await connectionFor(env.DB,owner.owner_user_id);if(!connection?.enabled||connection.owner_id!==owner.owner_user_id)return;
 try{await syncCalendar(env,{role:'superadmin',userId:owner.owner_user_id,boardId:owner.owner_user_id,email:owner.owner_email,name:owner.owner_name})}catch{/* Sanitized status is stored for the owner; never log Google responses or credentials. */}
}
