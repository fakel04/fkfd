'use client';
import {useEffect,useState} from 'react';
import {CalendarDays,RefreshCw,ExternalLink} from 'lucide-react';
import type {CalendarValue} from '../google-calendar-model';
type Status={configured:boolean;connected:boolean;calendarId:string|null;timeZone:string|null;lastSync:string|null;error:string|null;running:boolean;conflictCount:number;conflicts:{taskId:string;local:CalendarValue|null;remote:CalendarValue|null}[]};
const version=(value:CalendarValue|null)=>value?`${value.done?'✓ ':''}${value.title} · ${/^\d{4}-\d{2}-\d{2}$/.test(value.when)?value.when:new Date(value.when).toLocaleString('ru')}`:'Без даты / удалено';
export default function GoogleCalendarSettings(){
 const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function load(){const response=await fetch('/api/calendar',{cache:'no-store'});const body=await response.json() as Status&{error?:string};if(!response.ok)throw new Error(body.error||'Не удалось загрузить календарь.');setStatus(body)}
 useEffect(()=>{
  load().catch(error=>setError(error.message));
  const result=new URLSearchParams(location.search).get('calendar');
  if(result){if(result==='connected')setMessage('Календарь подключён. Синхронизация запустится автоматически в течение пяти минут.');else setError(result);const url=new URL(location.href);url.searchParams.delete('calendar');history.replaceState(null,'',url)}
 },[]);
 async function action(action:string,extra:Record<string,string>={}){
  setBusy(true);setError('');setMessage('');
  try{
   const response=await fetch('/api/calendar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...extra})});const body=await response.json() as {error?:string;url?:string;pending?:number;processed?:number};if(!response.ok)throw new Error(body.error||'Не удалось выполнить запрос.');
   if(body.url){location.assign(body.url);return}
   await load();
   setMessage(action==='disconnect'?'Связь отключена. Календарь и дела сохранены.':action==='resolve'?'Версия выбрана. Нажмите «Синхронизировать сейчас».':body.pending?`Обработано изменений: ${body.processed}. Осталось: ${body.pending}. Продолжим автоматически.`:'Синхронизация завершена.');
  }catch(error){setError((error as Error).message);await load().catch(()=>{})}finally{setBusy(false)}
 }
 return <section className="admin-card calendar-settings" aria-labelledby="calendar-heading"><h2 id="calendar-heading"><CalendarDays size={20}/>Google Календарь</h2>
  <p>Отдельный календарь «Облака»: даты и названия дел обновляются в обе стороны примерно раз в пять минут. Подключение охватывает дела из всех активных облаков доски.</p>
  {error&&<div className="admin-error" role="alert">{error}</div>}{message&&<div className="admin-message" role="status">{message}</div>}
  {!status?<button className="secondary" disabled={busy} onClick={()=>load().catch(error=>setError(error.message))}>Обновить состояние</button>:<>
   {status.error&&<p className="admin-notice" role="status">{status.error}</p>}
   {status.connected?<>
    <p>Подключён · {status.timeZone}{status.lastSync&&<> · Последняя синхронизация: {new Date(status.lastSync).toLocaleString('ru')}</>}{status.running&&' · Синхронизация идёт…'}</p>
    <div className="calendar-actions"><button className="primary" disabled={busy||status.running} onClick={()=>action('sync')}><RefreshCw size={16}/>{busy?'Подождите…':'Синхронизировать сейчас'}</button><button className="secondary" disabled={busy} onClick={()=>load().catch(error=>setError(error.message))}>Обновить состояние</button><a className="secondary" href="https://calendar.google.com/" target="_blank" rel="noreferrer"><ExternalLink size={16}/>Открыть календарь</a><button className="secondary" disabled={busy||!status.configured} onClick={()=>action('connect',{timeZone:status.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'})}>Подключить заново</button><button className="secondary" disabled={busy} onClick={()=>{if(confirm('Отключить синхронизацию? Календарь и дела сохранятся.'))action('disconnect')}}>Отключить</button></div>
   </>:status.configured?<button className="primary" disabled={busy} onClick={()=>action('connect',{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'})}>{busy?'Подождите…':status.calendarId?'Подключить заново':'Подключить Google'}</button>:<p className="admin-notice">Для первого подключения нужно настроить Google OAuth и секреты Worker. После настройки нажмите «Обновить состояние».</p>}
   {!status.connected&&<div className="calendar-actions"><button className="secondary" disabled={busy} onClick={()=>load().catch(error=>setError(error.message))}>Обновить состояние</button></div>}
   {!!status.conflictCount&&<div className="calendar-conflicts"><h3>Нужно выбрать версию: {status.conflictCount}</h3><p>Одно поле изменили с обеих сторон. Выберите, какое значение сохранить.</p>{status.conflicts.map(conflict=><article key={conflict.taskId}><p><b>Облака:</b> {version(conflict.local)}</p><p><b>Календарь:</b> {version(conflict.remote)}</p><div className="calendar-actions"><button className="secondary" disabled={busy||!status.connected} onClick={()=>action('resolve',{taskId:conflict.taskId,resolution:'local'})}>Из «Облаков»</button><button className="secondary" disabled={busy||!status.connected} onClick={()=>action('resolve',{taskId:conflict.taskId,resolution:'remote'})}>Из календаря</button></div></article>)}</div>}
  </>}
  <details><summary>Как работает связь и первое подключение</summary><p>Дело без времени — событие на весь день. С временем — событие на 30 минут; изменённая в Google длительность сохраняется. Выполненные дела отмечаются ✓ в названии события.</p><p>Удаление события убирает дату у дела. Удаление даты, архивирование или удаление дела убирает событие. Комментарии и описание дела сохраняются. Новые события календаря попадают в облако «Google Календарь», доступное владельцу и администраторам; участникам доступ выдаётся отдельно.</p><p>Повторяющиеся события пока пропускаются. Офлайн-правки передаются после сохранения доски на сервере. Не выдавайте доступ к этому календарю тем, кому нельзя видеть дела всех облаков.</p><p><a href="https://github.com/fakel04/fkfd/blob/main/docs/google-calendar.md" target="_blank" rel="noreferrer">Инструкция по настройке Google OAuth ↗</a></p></details>
 </section>;
}
