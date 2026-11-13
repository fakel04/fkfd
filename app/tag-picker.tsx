'use client';
import {useState} from 'react';
import {Check,Plus,Search,Tag} from 'lucide-react';
import {hasLabel,labelKey,uniqueLabels} from './board-model';

export function TagPicker({title,options,value,onApply,onCancel}:{title:string;options:string[];value:string[];onApply:(labels:string[])=>void;onCancel:()=>void}){
 const [selected,setSelected]=useState(()=>uniqueLabels(value));
 const [query,setQuery]=useState('');
 const all=uniqueLabels([...options,...selected]).sort((a,b)=>a.localeCompare(b,'ru'));
 const visible=all.filter(label=>labelKey(label).includes(labelKey(query)));
 const proposed=query.trim();
 function toggle(label:string){setSelected(current=>hasLabel(current,label)?current.filter(item=>labelKey(item)!==labelKey(label)):current.length<100?[...current,label]:current)}
 return <div className="small-modal tag-picker">
  <h2>{title}</h2>
  <label className="tag-search"><Search size={18}/><input autoFocus aria-label="Найти или создать тег" placeholder="Найти или создать тег" maxLength={100} value={query} onChange={event=>setQuery(event.target.value)}/></label>
  <div className="tag-choice-list" role="group" aria-label="Выберите теги">
   {visible.map(label=><label key={labelKey(label)} className="tag-choice"><input type="checkbox" checked={hasLabel(selected,label)} disabled={!hasLabel(selected,label)&&selected.length>=100} onChange={()=>toggle(label)}/><Tag size={17}/><span>{label}</span></label>)}
   {!!proposed&&!hasLabel(all,proposed)&&<button type="button" className="tag-create" disabled={selected.length>=100} onClick={()=>{toggle(proposed);setQuery('')}}><Plus size={18}/>Создать «{proposed}»</button>}
   {!all.length&&!proposed&&<p className="tag-empty">Пока нет тегов. Введите название, чтобы добавить.</p>}
  </div>
  <div className="tag-picker-footer"><button type="button" className="text-button" disabled={!selected.length} onClick={()=>setSelected([])}>Снять все</button><span>{selected.length?`Выбрано: ${selected.length}`:'Без тегов'}</span></div>
  <div className="modal-actions"><button type="button" className="text-button" onClick={onCancel}>Отмена</button><button type="button" className="primary" onClick={()=>onApply(selected)}><Check size={17}/>Применить</button></div>
 </div>;
}
