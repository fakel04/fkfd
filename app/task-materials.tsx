'use client';
import {useEffect,useRef,useState} from 'react';
import {ExternalLink,Paperclip,Plus} from 'lucide-react';
import {materialInput,fileMaterialInput,materialBase,materialUrl,MAX_FILE_BYTES,MAX_TASK_MATERIALS,sourceNames,type MaterialInput,type TaskMaterial} from './task-materials-model';
import type {Task} from './board-model';

async function responseBody(response:Response){
 let data;try{data=await response.json() as {items:TaskMaterial[];uploadsEnabled:boolean;item:TaskMaterial;error?:string}}catch{throw new Error('Не удалось загрузить материалы. Проверьте подключение и вход в аккаунт.')}
 if(!response.ok)throw new Error(data.error||'Не удалось сохранить материал. Повторите попытку.');return data;
}
function safeHref(value:string){try{return materialUrl(value)}catch{return ''}}
const empty:MaterialInput={kind:'summary',text:'',title:'',source:'other',sourceUrl:'',url:''};

export function TaskMaterials({task}:{task:Task}){
 const [items,setItems]=useState<TaskMaterial[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [selectedFile,setSelectedFile]=useState<File|null>(null);
 const [uploads,setUploads]=useState(false),[editing,setEditing]=useState<TaskMaterial|'new'|null>(null),[draft,setDraft]=useState<MaterialInput>(empty),[confirmDelete,setConfirmDelete]=useState<string|null>(null);
 const fileInput=useRef<HTMLInputElement>(null);const base=materialBase(task.id);
 async function load(signal?:AbortSignal){
  setLoading(true);setError('');
  try{const data=await responseBody(await fetch(base,{cache:'no-store',signal,redirect:'error'}));if(!signal?.aborted){setItems(data.items);setUploads(data.uploadsEnabled)}}
  catch(error){if(!signal?.aborted)setError(error instanceof Error?error.message:'Для материалов нужно подключение к интернету.')}
  finally{if(!signal?.aborted)setLoading(false)}
 }
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort()},[base]);
 function start(kind:'summary'|'link',item?:TaskMaterial){
  setConfirmDelete(null);setError('');setSelectedFile(null);setEditing(item??'new');setDraft(item?{kind:item.kind==='link'?'link':'summary',text:item.text,title:item.title,source:item.source,sourceUrl:item.sourceUrl,url:item.url}:{...empty,kind});
 }
 async function save(){
  if(selectedFile){await upload(selectedFile);return}
  const parsed=materialInput.safeParse(draft);if(!parsed.success){setError(parsed.error.issues[0].message);return}
  setBusy(true);setError('');
  try{
   const existing=editing&&editing!=='new'?editing:null;
   const data=await responseBody(await fetch(existing?base+'/'+encodeURIComponent(existing.id):base,{method:existing?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...parsed.data,...existing?{revision:existing.revision}:{}}),redirect:'error'}));
   setItems(current=>existing?current.map(item=>item.id===existing.id?data.item:item):[...current,data.item]);setEditing(null);
  }catch(error){setError(error instanceof Error?error.message:'Не удалось сохранить.')}finally{setBusy(false)}
 }
 async function upload(file:File){
  if(!file.size||file.size>MAX_FILE_BYTES){setError('Выберите непустой файл размером до 10 МБ.');return}
  const metadata=fileMaterialInput.safeParse(draft);if(!metadata.success){setError(metadata.error.issues[0].message);return}
  setBusy(true);setError('');
  try{const form=new FormData();form.set('file',file);for(const [key,value] of Object.entries(metadata.data))form.set(key,value);const data=await responseBody(await fetch(base,{method:'POST',body:form,redirect:'error'}));setItems(current=>[...current,data.item]);setEditing(null);setSelectedFile(null)}
  catch(error){setError(error instanceof Error?error.message:'Не удалось загрузить файл.')}finally{setBusy(false);if(fileInput.current)fileInput.current.value=''}
 }
 async function remove(item:TaskMaterial){
  setBusy(true);setError('');
  try{await responseBody(await fetch(base+'/'+encodeURIComponent(item.id)+'?revision='+item.revision,{method:'DELETE',redirect:'error'}));setItems(current=>current.filter(value=>value.id!==item.id));setConfirmDelete(null)}
  catch(error){setError(error instanceof Error?error.message:'Не удалось удалить материал.')}finally{setBusy(false)}
 }
 const prefix='material-'+task.id;
 return <section className="task-materials" aria-label="Комментарии и материалы">
  <h3>Комментарии и материалы</h3>
  <p className="materials-hint">Саммари чатов, заметки и артефакты. Сохраняются сразу, отдельно от описания. Для работы нужен интернет.</p>
  {loading&&<p role="status">Загружаем материалы…</p>}
  {error&&<div role="alert" className="materials-error"><p>{error}</p><button type="button" disabled={busy||loading} onClick={()=>void load()}>Обновить список</button></div>}
  {!loading&&<>
   {!items.length&&!error&&<p className="materials-hint">Пока нет комментариев и материалов.</p>}
   <div className="materials-list">{items.map(item=><article className="material-entry" key={item.id}>
    <div className="material-meta"><span>{item.kind==='file'?'Файл':item.kind==='link'?'Материал':'Комментарий / саммари'}{item.source!=='other'?' · '+sourceNames[item.source]:''}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'})}</time></div>
    {item.title&&<h4>{item.title}</h4>}
    {item.text&&<p className="material-text">{item.text}</p>}
    {item.kind==='link'&&safeHref(item.url)&&<a className="material-link" href={safeHref(item.url)} target="_blank" rel="noopener noreferrer">Открыть материал<ExternalLink size={15}/></a>}
    {item.sourceUrl&&safeHref(item.sourceUrl)&&<a className="material-link" href={safeHref(item.sourceUrl)} target="_blank" rel="noopener noreferrer">Исходный чат<ExternalLink size={15}/></a>}
    {item.kind==='file'&&<a className="material-link" href={base+'/'+encodeURIComponent(item.id)} target="_blank" rel="noopener noreferrer"><Paperclip size={15}/>Скачать {item.fileName} ({Math.max(1,Math.ceil((item.fileSize??0)/1024))} КБ)</a>}
    <div className="material-author">{item.authorName}</div>
    <div className="material-actions">
     {item.kind!=='file'&&<button type="button" disabled={busy||!!editing} onClick={()=>start(item.kind==='link'?'link':'summary',item)}>Изменить</button>}
     {confirmDelete===item.id?<><span>Удалить эту запись?</span><button type="button" disabled={busy} onClick={()=>void remove(item)}>Да, удалить</button><button type="button" disabled={busy} onClick={()=>setConfirmDelete(null)}>Отмена</button></>:<button type="button" disabled={busy||!!editing} onClick={()=>setConfirmDelete(item.id)}>Удалить</button>}
    </div>
   </article>)}</div>
   {!editing&&items.length<MAX_TASK_MATERIALS&&<div className="material-add-actions">
    <button type="button" disabled={busy} onClick={()=>start('summary')}><Plus size={16}/>Комментарий / саммари</button>
    <button type="button" disabled={busy} onClick={()=>start('link')}><Plus size={16}/>Ссылка на артефакт</button>
    <button type="button" disabled={busy||!uploads} onClick={()=>fileInput.current?.click()}><Paperclip size={16}/>{busy?'Подождите…':'Прикрепить файл'}</button>
    <input ref={fileInput} type="file" hidden aria-label="Файл для дела" disabled={busy||!uploads} onChange={event=>{const file=event.target.files?.[0];if(file){if(!file.size||file.size>MAX_FILE_BYTES){setError('Выберите непустой файл размером до 10 МБ.');event.target.value='';return}start('summary');setSelectedFile(file);setDraft({...empty,title:file.name.slice(0,300)})}}}/>
   </div>}
   {!uploads&&<p className="materials-hint">Загрузка файлов появится после подключения R2. Сейчас можно добавить ссылку на артефакт.</p>}
   {uploads&&<p className="materials-hint">Файлы — до 10 МБ. Скачивание доступно участникам с доступом к этому делу.</p>}
   {editing&&<form className="material-form" onSubmit={event=>{event.preventDefault();void save()}}>
    <h4>{selectedFile?'Прикрепить файл':editing==='new'?'Добавить запись':'Изменить запись'}</h4>{selectedFile&&<p className="materials-hint">{selectedFile.name} · {Math.max(1,Math.ceil(selectedFile.size/1024))} КБ</p>}
    <label htmlFor={prefix+'-title'}>Заголовок (необязательно)</label><input id={prefix+'-title'} autoFocus maxLength={300} value={draft.title} disabled={busy} onChange={event=>setDraft({...draft,title:event.target.value})}/>
    <label htmlFor={prefix+'-source'}>Источник</label><select id={prefix+'-source'} value={draft.source} disabled={busy} onChange={event=>{const source=event.target.value as MaterialInput['source'];setDraft({...draft,source,sourceUrl:source==='gpt'?task.gptUrl||'':source==='claude'?task.claudeUrl||'':''})}}>{Object.entries(sourceNames).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select>
    <label htmlFor={prefix+'-chat'}>Ссылка на исходный чат (необязательно)</label><input id={prefix+'-chat'} type="url" inputMode="url" maxLength={2048} value={draft.sourceUrl} disabled={busy} onChange={event=>setDraft({...draft,sourceUrl:event.target.value})}/>
    {!selectedFile&&draft.kind==='link'&&<><label htmlFor={prefix+'-url'}>Ссылка на артефакт</label><input id={prefix+'-url'} type="url" inputMode="url" required maxLength={2048} value={draft.url} disabled={busy} onChange={event=>setDraft({...draft,url:event.target.value})}/></>}
    <label htmlFor={prefix+'-text'}>{!selectedFile&&draft.kind==='summary'?'Комментарий / саммари':'Пояснение (необязательно)'}</label><textarea id={prefix+'-text'} required={!selectedFile&&draft.kind==='summary'} rows={6} maxLength={20000} value={draft.text} disabled={busy} onChange={event=>setDraft({...draft,text:event.target.value})}/>
    <div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={()=>{setEditing(null);setSelectedFile(null);setError('')}}>Отмена</button><button type="submit" className="primary" disabled={busy}>{busy?'Сохраняем…':selectedFile?'Загрузить файл':'Сохранить запись'}</button></div>
   </form>}
  </>}
 </section>;
}
