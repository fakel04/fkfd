'use client';
import {useState} from 'react';
import {type Choices,type MergeConflict} from './board-merge';
function show(value:unknown):string{
 if(value===null||value===undefined)return 'Удалено / не задано';
 if(typeof value==='boolean')return value?'Да':'Нет';
 if(typeof value==='string')return value||'Пустой текст';
 if(Array.isArray(value))return value.map(show).join('\n');
 if(typeof value==='object')return JSON.stringify(value,null,2);
 return String(value);
}
export function SyncConflicts({conflicts,onResolve,onExport}:{conflicts:MergeConflict[];onResolve:(choices:Choices)=>Promise<void>;onExport:()=>void}){
 const [choices,setChoices]=useState<Choices>({});const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 return <div className="sync-conflicts"><h2>Выберите изменения</h2><p>Эта деталь изменена и здесь, и на другом устройстве. Остальные правки объединятся автоматически.</p>
  {conflicts.map(c=><fieldset key={c.key}><legend>{c.title} · {c.field}</legend><details><summary>До изменений</summary><pre>{show(c.base)}</pre></details>
   {(['local','remote'] as const).map(side=><label key={side}><input type="radio" name={c.key} checked={choices[c.key]===side} onChange={()=>setChoices({...choices,[c.key]:side})}/><strong>{side==='local'?'На этом устройстве':'На сервере'}</strong><pre>{show(c[side])}</pre></label>)}
  </fieldset>)}
  {error&&<p role="alert">{error}</p>}<div className="modal-actions"><button className="secondary" onClick={onExport}>Скачать копию</button><button className="primary" disabled={busy||conflicts.some(c=>!choices[c.key])} onClick={async()=>{setBusy(true);try{await onResolve(choices)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>Сохранить выбранное</button></div>
 </div>
}
