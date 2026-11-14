'use client';
import {useState} from 'react';
import {ExternalLink,Link2} from 'lucide-react';
import {aiProviders,normalizeAiLink,safeAiLink,type AiProvider} from './task-ai-links';
import type {Task} from './board-model';

function ProviderLink({provider,value,onApply}:{provider:AiProvider;value?:string|null;onApply:(url:string|null)=>void}){
 const info=aiProviders[provider];
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState(value??''),[error,setError]=useState('');
 const href=safeAiLink(provider,value);
 function edit(){setDraft(value??'');setError('');setEditing(true)}
 return <section className="task-ai-link" aria-label={'Связь с '+info.name}>
  <div className="task-ai-link-heading"><strong>{info.name}</strong>
   {href&&<a href={href} target="_blank" rel="noopener noreferrer">Открыть {info.name}<ExternalLink size={16}/></a>}
  </div>
  {!editing?<button type="button" className="task-ai-link-edit" onClick={edit}><Link2 size={16}/>{value?'Изменить ссылку':'Добавить ссылку'}</button>:
   <form onSubmit={event=>{event.preventDefault();try{onApply(normalizeAiLink(provider,draft));setEditing(false);setError('')}catch(error){setError(error instanceof Error?error.message:'Не удалось сохранить ссылку.')}}}>
    <label htmlFor={'task-ai-'+provider}>Ссылка на чат в {info.name}</label>
    <input id={'task-ai-'+provider} autoFocus type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={2048} placeholder={info.placeholder} value={draft} aria-invalid={!!error} aria-describedby={error?'task-ai-error-'+provider:undefined} onChange={event=>{setDraft(event.target.value);setError('')}}/>
    {error&&<p id={'task-ai-error-'+provider} role="alert" className="task-ai-link-error">{error}</p>}
    <div className="task-ai-link-actions">
     {value&&<button type="button" className="text-button" onClick={()=>{onApply(null);setEditing(false);setError('')}}>Удалить ссылку</button>}
     <button type="button" className="text-button" onClick={()=>setEditing(false)}>Отмена</button>
     <button type="submit" className="primary">Сохранить</button>
    </div>
   </form>}
 </section>;
}

export function TaskAiLinksEditor({task,onApply}:{task:Task;onApply:(changes:Partial<Task>)=>void}){
 return <div className="task-ai-links">
  <h3>Чаты по делу</h3>
  {(['gpt','claude'] as const).map(provider=><ProviderLink key={provider} provider={provider} value={task[aiProviders[provider].field]} onApply={url=>onApply({[aiProviders[provider].field]:url})}/>)}
 </div>;
}
