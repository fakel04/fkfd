import {taskDueDate,type Board,type Task} from './board-model.ts';
export type CalendarValue={title:string;when:string;done:boolean};
export type GoogleEvent={id:string;etag?:string;status?:string;summary?:string;start?:{date?:string;dateTime?:string};end?:{date?:string;dateTime?:string};recurrence?:string[];recurringEventId?:string;extendedProperties?:{private?:Record<string,string>}};
export const CALENDAR_SCOPE='https://www.googleapis.com/auth/calendar.app.created';
export const calendarFields=['title','when','done'] as const;
export const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function calendarWhen(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:new Date(value).toISOString()}
export function calendarTask(task:Task):CalendarValue|null{const when=taskDueDate(task);return when&&task.text.trim()?{title:task.text,when:calendarWhen(when),done:task.done}:null}
export function calendarTasks(board:Board){return new Map(board.notes.flatMap(note=>note.tasks.map(task=>[task.id,!note.deleted&&!note.archived?calendarTask(task):null] as const)))}
export function calendarEvent(event:GoogleEvent):CalendarValue|null{
 if(event.status==='cancelled')return null;
 const when=event.start?.date||event.start?.dateTime;if(!when)throw new Error('Событие без даты.');
 const summary=event.summary||'Без названия';
 return {title:summary.startsWith('✓ ')?summary.slice(2):summary,when:calendarWhen(when),done:summary.startsWith('✓ ')};
}
export function mergeCalendar(base:CalendarValue|null,local:CalendarValue|null,remote:CalendarValue|null):{value:CalendarValue|null;conflict:boolean}{
 if(same(local,remote)||same(remote,base))return {value:local,conflict:false};
 if(same(local,base))return {value:remote,conflict:false};
 if(!base||!local||!remote)return {value:local,conflict:true};
 const value={...local};for(const key of calendarFields){
  if(local[key]===remote[key]||remote[key]===base[key])continue;
  if(local[key]!==base[key])return {value:local,conflict:true};
  Object.assign(value,{[key]:remote[key]});
 }
 return {value,conflict:false};
}
export function eventBody(value:CalendarValue,previous?:GoogleEvent){
 const summary=(value.done?'✓ ':'')+value.title;
 if(/^\d{4}-\d{2}-\d{2}$/.test(value.when)){
  let days=1;if(previous?.start?.date&&previous.end?.date)days=Math.max(1,Math.round((Date.parse(previous.end.date)-Date.parse(previous.start.date))/86400000));
  return {summary,start:{date:value.when},end:{date:new Date(Date.parse(value.when)+days*86400000).toISOString().slice(0,10)}};
 }
 let duration=1800000;if(previous?.start?.dateTime&&previous.end?.dateTime)duration=Math.max(60000,Date.parse(previous.end.dateTime)-Date.parse(previous.start.dateTime));
 return {summary,start:{dateTime:value.when},end:{dateTime:new Date(Date.parse(value.when)+duration).toISOString()}};
}
export function calendarZone(value:unknown){
 if(typeof value!=='string'||value.length>100)throw new Error('Неверный часовой пояс.');
 new Intl.DateTimeFormat('ru',{timeZone:value}).format();return value;
}
