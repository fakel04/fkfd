'use client';
import {useState} from 'react';
import {Check} from 'lucide-react';

export function TaskDescriptionEditor({value,onApply,onCancel}:{value:string;onApply:(text:string)=>void;onCancel:()=>void}){
 const [text,setText]=useState(value);
 return <form className="small-modal task-description-editor" onSubmit={event=>{event.preventDefault();onApply(text.trim()?text:'')}}>
  <h2>Описание задачи</h2>
  <textarea autoFocus aria-label="Описание задачи" placeholder="Детали, ссылки, заметки…" rows={9} maxLength={50000} value={text} onChange={event=>setText(event.target.value)}/>
  <div className="modal-actions"><button type="button" className="text-button" onClick={()=>onApply('')}>Убрать описание</button><button type="button" className="text-button" onClick={onCancel}>Отмена</button><button className="primary"><Check size={17}/>Применить</button></div>
 </form>;
}
