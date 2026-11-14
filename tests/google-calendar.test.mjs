import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {calendarTask,calendarEvent,mergeCalendar,eventBody,CALENDAR_SCOPE} from '../app/google-calendar-model.ts';
import {calendarHash,openCalendar,sealCalendar} from '../app/google-calendar-crypto.ts';
import {beginCalendar,finishCalendar,calendarStatus,disconnectCalendar,resolveCalendar} from '../app/google-calendar-store.ts';
import {syncCalendar,applyCalendarValue} from '../app/google-calendar-sync.ts';
const note=(id,tasks)=>({id,title:id,text:'',tasks,color:'white',category:'',pinned:false,archived:false,deleted:false,created:'2026-11-14T00:00:00.000Z'});
const task=(id,extra={})=>({id,text:'Дело '+id,done:false,dueDate:'2026-11-20',...extra});
const base={title:'План',when:'2026-11-20',done:false};
function setup(tasks=[task('a')]){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 const prepare=query=>{let args=[];const stmt={bind(...values){args=values;return stmt},async first(){return sql.prepare(query).get(...args)??null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}}}};return stmt};
 const db={prepare,async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result}catch(error){sql.exec('ROLLBACK');throw error}}};
 const owner={role:'superadmin',userId:'owner',boardId:'owner',email:'owner@test',name:'Владелец'};
 const board={notes:[note('cloud',tasks)],categories:[]};sql.prepare('INSERT INTO boards VALUES (?,?,?,?)').run('owner',JSON.stringify(board),1,'now');
 const key=Buffer.alloc(32,7).toString('base64'),env={DB:db,GOOGLE_CALENDAR_CLIENT_ID:'client',GOOGLE_CALENDAR_CLIENT_SECRET:'secret',GOOGLE_CALENDAR_TOKEN_KEY:key};
 const get=()=>JSON.parse(sql.prepare('SELECT data FROM boards').get().data);
 const set=board=>sql.prepare('UPDATE boards SET data=?,revision=revision+1').run(JSON.stringify(board));
 const events=new Map(),calls=[];let sequence=0,hook=null,fail=null;
 const fetchImpl=async(url,init={})=>{
  const path=new URL(url),body=init.body?JSON.parse(String(init.body).startsWith('{')?init.body:'{}'):null,method=init.method||'GET';calls.push({url:String(url),method,body,headers:init.headers});
  if(hook)await hook(path,init);
  if(fail){const response=fail(path,init);if(response)return response}
  if(path.hostname==='oauth2.googleapis.com'){
   if(path.pathname==='/revoke')return new Response('{}');
   return Response.json({access_token:'access',refresh_token:'refresh',scope:CALENDAR_SCOPE});
  }
  if(path.pathname==='/calendar/v3/calendars'&&method==='POST')return Response.json({id:'dedicated'});
  if(path.pathname==='/calendar/v3/calendars/dedicated'&&method==='GET')return Response.json({id:'dedicated'});
  const prefix='/calendar/v3/calendars/dedicated/events';assert.ok(path.pathname.startsWith(prefix));
  if(path.pathname===prefix&&method==='GET')return Response.json({items:[...events.values()]});
  const id=decodeURIComponent(path.pathname.slice(prefix.length+1));
  if(method==='GET')return events.has(id)?Response.json(events.get(id)):new Response('{}',{status:404});
  if(method==='POST'){
   if(events.has(body.id))return new Response('{}',{status:409});
   const event={...body,etag:'e'+(++sequence),status:'confirmed'};events.set(body.id,event);return Response.json(event);
  }
  if(!events.has(id))return new Response('{}',{status:404});
  if(init.headers?.['If-Match']&&init.headers['If-Match']!==events.get(id).etag)return new Response('{}',{status:412});
  if(method==='DELETE'){events.set(id,{id,status:'cancelled',etag:'e'+(++sequence)});return new Response(null,{status:204})}
  assert.equal(method,'PATCH');events.set(id,{...events.get(id),...body,etag:'e'+(++sequence)});return Response.json(events.get(id));
 };
 const connect=async()=>{const result=await beginCalendar(env,owner,'https://oblaka.test','Europe/Moscow');const callback=new URL('https://oblaka.test/api/calendar/callback?'+new URLSearchParams({state:result.state,code:'code'}));await finishCalendar(env,owner,callback,result.state,fetchImpl);return result};
 return {sql,db,env,owner,key,get,set,events,calls,fetchImpl,connect,hook:fn=>{hook=fn},fail:fn=>{fail=fn}};
}

test('calendar projections preserve all-day dates, absolute instants, completion and edited duration',()=>{
 assert.deepEqual(calendarTask(task('a',{dueDate:null,todoist:{dueDate:'2026-11-21'}})),null);
 assert.equal(calendarTask(task('a',{dueDate:'2026-11-20T15:30:00+03:00'})).when,'2026-11-20T12:30:00.000Z');
 assert.equal(calendarTask(task('a',{text:'  '})),null);
 assert.deepEqual(eventBody(base),{summary:'План',start:{date:'2026-11-20'},end:{date:'2026-11-21'}});
 const timed={...base,when:'2026-11-20T12:30:00.000Z',done:true};const event=eventBody(timed,{start:{dateTime:'2026-11-19T12:30:00Z'},end:{dateTime:'2026-11-19T14:00:00Z'}});
 assert.equal(event.end.dateTime,'2026-11-20T14:00:00.000Z');assert.deepEqual(calendarEvent({id:'event',...event}),timed);
 assert.equal(eventBody(base,{start:{date:'2026-11-19'},end:{date:'2026-11-22'}}).end.date,'2026-11-23');
 assert.equal(calendarEvent({id:'a',status:'cancelled'}),null);
 assert.deepEqual(mergeCalendar(base,{...base,title:'Новый план'},{...base,when:'2026-11-22'}),{conflict:false,value:{...base,title:'Новый план',when:'2026-11-22'}});
 assert.equal(mergeCalendar(base,{...base,when:'2026-11-21'},{...base,when:'2026-11-22'}).conflict,true);
 assert.equal(mergeCalendar(base,base,null).value,null);assert.equal(mergeCalendar(base,{...base,title:'Правка'},null).conflict,true);
});

test('OAuth uses least privilege, PKCE, owner-bound one-time state and encrypted credentials; reconnect reuses calendar',async()=>{
 const s=setup();const member={...s.owner,role:'member'};
 for(const run of [()=>beginCalendar(s.env,member,'https://oblaka.test','UTC'),()=>calendarStatus(s.env,member),()=>syncCalendar(s.env,member,s.fetchImpl),()=>disconnectCalendar(s.env,member),()=>resolveCalendar(s.env,member,'a','remote')])await assert.rejects(run,e=>e.status===403);
 const started=await beginCalendar(s.env,s.owner,'https://oblaka.test','Europe/Moscow'),auth=new URL(started.url);
 assert.equal(auth.searchParams.get('scope'),CALENDAR_SCOPE);assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.equal(auth.searchParams.get('access_type'),'offline');
 const callback=new URL('https://oblaka.test/api/calendar/callback?'+new URLSearchParams({state:started.state,code:'code'}));
 await assert.rejects(()=>finishCalendar(s.env,s.owner,callback,'wrong',s.fetchImpl),e=>e.status===400);
 await finishCalendar(s.env,s.owner,callback,started.state,s.fetchImpl);
 await assert.rejects(()=>finishCalendar(s.env,s.owner,callback,started.state,s.fetchImpl),e=>e.status===400);
 const row=s.sql.prepare('SELECT * FROM calendar_connections').get();assert.notEqual(row.refresh_token,'refresh');assert.equal(await openCalendar(row.refresh_token,s.key,'refresh:owner'),'refresh');
 await assert.rejects(()=>openCalendar(row.refresh_token,s.key,'refresh:other'));
 const status=await calendarStatus(s.env,s.owner);assert.equal(status.connected,true);assert.equal(JSON.stringify(status).includes('refresh'),false);
 await s.connect();assert.equal(s.calls.filter(call=>call.method==='POST'&&call.url.endsWith('/calendars')).length,1);
 await disconnectCalendar(s.env,s.owner,s.fetchImpl);assert.equal((await calendarStatus(s.env,s.owner)).connected,false);assert.equal(s.sql.prepare('SELECT refresh_token FROM calendar_connections').get().refresh_token,null);
 assert.ok(s.calls.some(call=>call.url==='https://oauth2.googleapis.com/revoke'));
 assert.equal(s.calls.filter(call=>call.method==='DELETE').length,0);
});

test('export is idempotent; Google moves update the task and keep descriptions/material IDs',async()=>{
 const s=setup([task('a',{description:'Сохранить',gptUrl:'https://chatgpt.com/c/chat'})]);await s.connect();await syncCalendar(s.env,s.owner,s.fetchImpl);
 assert.equal(s.events.size,1);const event=[...s.events.values()][0];assert.equal(event.start.date,'2026-11-20');assert.equal(event.visibility,'private');assert.equal(s.calls.find(call=>call.body?.id===event.id).url.includes('sendUpdates=none'),true);
 await syncCalendar(s.env,s.owner,s.fetchImpl);assert.equal(s.calls.filter(call=>call.method==='POST'&&call.url.includes('/events')).length,1);
 s.events.set(event.id,{...event,start:{date:'2026-11-23'},end:{date:'2026-11-24'},etag:'moved'});await syncCalendar(s.env,s.owner,s.fetchImpl);
 const savedTask=s.get().notes[0].tasks[0];assert.equal(savedTask.dueDate,'2026-11-23');assert.equal(savedTask.description,'Сохранить');assert.equal(savedTask.gptUrl,'https://chatgpt.com/c/chat');
 const board=s.get();board.notes.push(note('other',[board.notes[0].tasks.pop()]));s.set(board);await syncCalendar(s.env,s.owner,s.fetchImpl);assert.equal(s.events.size,1);
});

test('independent concurrent edits merge; same-field conflicts require a fresh explicit choice',async()=>{
 const s=setup();await s.connect();await syncCalendar(s.env,s.owner,s.fetchImpl);const event=[...s.events.values()][0];
 let board=s.get();board.notes[0].tasks[0].text='Моё название';s.set(board);s.events.set(event.id,{...event,start:{date:'2026-11-24'},end:{date:'2026-11-25'},etag:'new'});
 await syncCalendar(s.env,s.owner,s.fetchImpl);assert.equal(s.get().notes[0].tasks[0].dueDate,'2026-11-24');assert.equal(s.events.get(event.id).summary,'Моё название');
 board=s.get();board.notes[0].tasks[0].dueDate='2026-11-25';s.set(board);s.events.set(event.id,{...s.events.get(event.id),start:{date:'2026-11-26'},end:{date:'2026-11-27'},etag:'next'});
 await syncCalendar(s.env,s.owner,s.fetchImpl);let status=await calendarStatus(s.env,s.owner);assert.equal(status.conflictCount,1);assert.equal(s.get().notes[0].tasks[0].dueDate,'2026-11-25');
 await resolveCalendar(s.env,s.owner,'a','remote');
 // A choice made for old values must not overwrite a later Google edit.
 s.events.set(event.id,{...s.events.get(event.id),start:{date:'2026-11-28'},end:{date:'2026-11-29'},etag:'later'});await syncCalendar(s.env,s.owner,s.fetchImpl);
 assert.equal((await calendarStatus(s.env,s.owner)).conflictCount,1);assert.equal(s.get().notes[0].tasks[0].dueDate,'2026-11-25');
 await resolveCalendar(s.env,s.owner,'a','remote');await syncCalendar(s.env,s.owner,s.fetchImpl);assert.equal(s.get().notes[0].tasks[0].dueDate,'2026-11-28');assert.equal((await calendarStatus(s.env,s.owner)).conflictCount,0);
});

test('event deletion clears only the date; clearing a date removes its event and re-adding recreates it',async()=>{
 const s=setup([task('a',{description:'Останется'})]);await s.connect();await syncCalendar(s.env,s.owner,s.fetchImpl);let event=[...s.events.values()][0];
 s.events.set(event.id,{id:event.id,status:'cancelled'});await syncCalendar(s.env,s.owner,s.fetchImpl);assert.equal(s.get().notes[0].tasks[0].dueDate,null);assert.equal(s.get().notes[0].tasks[0].description,'Останется');
 let board=s.get();board.notes[0].tasks[0].dueDate='2026-12-01';s.set(board);await syncCalendar(s.env,s.owner,s.fetchImpl);assert.equal([...s.events.values()].filter(e=>e.status!=='cancelled').length,1);
 event=[...s.events.values()].find(e=>e.status!=='cancelled');assert.equal(event.start.date,'2026-12-01');
 board=s.get();board.notes[0].tasks[0].dueDate=null;s.set(board);await syncCalendar(s.env,s.owner,s.fetchImpl);assert.equal(s.events.get(event.id).status,'cancelled');
 await syncCalendar(s.env,s.owner,s.fetchImpl);assert.equal(s.get().notes[0].tasks.length,1);
});

test('Google-created events import once into a new ungranted cloud; recurrence and archived tasks are skipped',async()=>{
 const s=setup([]);s.events.set('external',{id:'external',etag:'e',summary:'Встреча',start:{dateTime:'2026-11-20T15:00:00+03:00'},end:{dateTime:'2026-11-20T17:00:00+03:00'}});
 s.events.set('recurring',{id:'recurring',recurrence:['RRULE:FREQ=DAILY'],summary:'Ритуал',start:{date:'2026-11-20'}});
 s.events.set('exception',{id:'exception',recurringEventId:'recurring',summary:'Ритуал',start:{date:'2026-11-21'}});
 await s.connect();await syncCalendar(s.env,s.owner,s.fetchImpl);const imported=s.get().notes.find(n=>n.title==='Google Календарь');assert.equal(imported.tasks.length,1);assert.equal(imported.tasks[0].dueDate,'2026-11-20T12:00:00.000Z');
 assert.equal(s.sql.prepare('SELECT COUNT(*) count FROM cloud_access').get().count,0);await syncCalendar(s.env,s.owner,s.fetchImpl);assert.equal(s.get().notes.flatMap(n=>n.tasks).length,1);assert.equal(s.events.size,3);
 const board=s.get();board.notes.find(n=>n.id===imported.id).archived=true;s.set(board);await syncCalendar(s.env,s.owner,s.fetchImpl);assert.equal(s.events.get('external').status,'cancelled');
});

test('board CAS, Google etags, connection leases and retry after an uncertain insert prevent lost changes and duplicates',async()=>{
 const s=setup();await s.connect();let lost=true;
 s.fail((path,init)=>{if(lost&&path.pathname.endsWith('/events')&&init.method==='POST'){lost=false;const body=JSON.parse(init.body);s.events.set(body.id,{...body,etag:'arrived',status:'confirmed'});throw new Error('response lost')}return null});
 await assert.rejects(()=>syncCalendar(s.env,s.owner,s.fetchImpl));await syncCalendar(s.env,s.owner,s.fetchImpl);assert.equal(s.events.size,1);
 const event=[...s.events.values()][0];s.events.set(event.id,{...event,start:{date:'2026-11-23'},end:{date:'2026-11-24'},etag:'moved'});
 let raced=false;s.hook(path=>{if(!raced&&path.pathname.endsWith('/events')){raced=true;const board=s.get();board.notes[0].tasks[0].text='Свежая правка';s.set(board)}});
 await syncCalendar(s.env,s.owner,s.fetchImpl);assert.equal(s.get().notes[0].tasks[0].text,'Свежая правка');assert.equal(s.get().notes[0].tasks[0].dueDate,'2026-11-23');
 s.sql.prepare('UPDATE calendar_connections SET lease=?,lease_until=?').run('other',Date.now()+120000);await assert.rejects(()=>syncCalendar(s.env,s.owner,s.fetchImpl),e=>e.status===409);s.sql.prepare('UPDATE calendar_connections SET lease=NULL,lease_until=0').run();
 const board=s.get();board.notes[0].tasks[0].text='Локальное';s.set(board);s.hook((path,init)=>{if(init.method==='PATCH'){const current=s.events.get(event.id);s.events.set(event.id,{...current,etag:'concurrent-google-edit'})}});
 await assert.rejects(()=>syncCalendar(s.env,s.owner,s.fetchImpl),e=>e.status===502);assert.equal(s.get().notes[0].tasks[0].text,'Локальное');assert.notEqual(JSON.parse(s.sql.prepare('SELECT baseline FROM calendar_links').get().baseline).title,'Локальное');
});

test('disconnect invalidates an in-flight run and missing configuration never exposes credentials',async()=>{
 const s=setup();await s.connect();let once=false;s.hook(async(path)=>{if(!once&&path.pathname.endsWith('/events')){once=true;await disconnectCalendar(s.env,s.owner,s.fetchImpl)}});
 await assert.rejects(()=>syncCalendar(s.env,s.owner,s.fetchImpl),e=>e.status===409);assert.equal(s.events.size,0);
 const notConfigured={DB:s.db};assert.equal((await calendarStatus(notConfigured,s.owner)).configured,false);await disconnectCalendar(notConfigured,s.owner,s.fetchImpl);
 await assert.rejects(()=>beginCalendar(notConfigured,s.owner,'https://oblaka.test','UTC'),e=>e.status===503);
 const ciphertext=await sealCalendar('private',s.key,'one');await assert.rejects(()=>openCalendar(ciphertext.slice(0,-3)+'xxx',s.key,'one'));
});

test('large batches continue without duplicate imports or events; blank tasks are not exported',async()=>{
 const s=setup([...Array.from({length:25},(_,i)=>task('t'+i)),task('blank',{text:''})]);await s.connect();const first=await syncCalendar(s.env,s.owner,s.fetchImpl);assert.equal(first.processed,20);assert.equal(first.pending,5);await syncCalendar(s.env,s.owner,s.fetchImpl);assert.equal(s.events.size,25);assert.equal((await syncCalendar(s.env,s.owner,s.fetchImpl)).processed,0);
});

test('a lost creation response followed by deleting the task does not resurrect it',async()=>{
 const s=setup();await s.connect();let once=true;s.fail((path,init)=>{if(once&&path.pathname.endsWith('/events')&&init.method==='POST'){once=false;const body=JSON.parse(init.body);s.events.set(body.id,{...body,etag:'created',status:'confirmed'});throw new Error('response lost')}return null});
 await assert.rejects(()=>syncCalendar(s.env,s.owner,s.fetchImpl));const board=s.get();board.notes[0].tasks=[];s.set(board);await syncCalendar(s.env,s.owner,s.fetchImpl);
 assert.equal(s.get().notes.flatMap(note=>note.tasks).length,0);assert.equal([...s.events.values()][0].status,'cancelled');assert.equal(s.sql.prepare('SELECT pending FROM calendar_links').get().pending,null);
});

test('remote apply and baseline commit are atomic when the board changes during an outbound request',async()=>{
 const s=setup();await s.connect();await syncCalendar(s.env,s.owner,s.fetchImpl);const event=[...s.events.values()][0];
 const board=s.get();board.notes[0].tasks[0].text='Моё название';s.set(board);s.events.set(event.id,{...event,start:{date:'2026-11-24'},end:{date:'2026-11-25'},etag:'remote-moved'});
 let once=true;s.hook((path,init)=>{if(once&&init.method==='PATCH'){once=false;const latest=s.get();latest.notes[0].tasks[0].description='Параллельная правка';s.set(latest)}});
 await assert.rejects(()=>syncCalendar(s.env,s.owner,s.fetchImpl),e=>e.status===409);
 assert.equal(s.get().notes[0].tasks[0].dueDate,'2026-11-20');assert.equal(JSON.parse(s.sql.prepare('SELECT baseline FROM calendar_links').get().baseline).when,'2026-11-20');
 await syncCalendar(s.env,s.owner,s.fetchImpl);assert.equal(s.get().notes[0].tasks[0].dueDate,'2026-11-24');assert.equal(s.get().notes[0].tasks[0].description,'Параллельная правка');assert.equal(s.get().notes[0].tasks[0].text,'Моё название');
});

test('an incomplete page listing, expired OAuth state and insufficient Google scope never mutate the board',async()=>{
 const s=setup();const before=s.get();let result=await beginCalendar(s.env,s.owner,'https://oblaka.test','UTC');s.sql.prepare('UPDATE calendar_oauth SET expires_at=0').run();
 await assert.rejects(()=>finishCalendar(s.env,s.owner,new URL('https://oblaka.test/api/calendar/callback?state='+result.state+'&code=code'),result.state,s.fetchImpl),e=>e.status===400);
 result=await beginCalendar(s.env,s.owner,'https://oblaka.test','UTC');s.fail(path=>path.hostname==='oauth2.googleapis.com'?Response.json({access_token:'access',refresh_token:'refresh',scope:'openid'}):null);
 await assert.rejects(()=>finishCalendar(s.env,s.owner,new URL('https://oblaka.test/api/calendar/callback?state='+result.state+'&code=code'),result.state,s.fetchImpl),e=>e.status===400);assert.equal(s.sql.prepare('SELECT COUNT(*) count FROM calendar_connections').get().count,0);
 s.fail(()=>null);await s.connect();s.fail(path=>path.pathname.endsWith('/events')?Response.json({items:[],nextPageToken:'more'}):null);await assert.rejects(()=>syncCalendar(s.env,s.owner,s.fetchImpl),e=>e.status===413);assert.deepEqual(s.get(),before);assert.equal(s.sql.prepare('SELECT COUNT(*) count FROM calendar_links').get().count,0);
});
