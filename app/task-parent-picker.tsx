'use client';
import {useState} from 'react';
import {Check,CornerDownRight,Search} from 'lucide-react';
import type {Board,Task,TaskParent} from './board-model';
import {parentChoices,taskParent} from './task-relations';

export function TaskParentPicker({board,task,onApply,onCancel}:{board:Board;task:Task;onApply:(parent:TaskParent|null)=>void;onCancel:()=>void}){
 const [query,setQuery]=useState('');
 const current=taskParent(board,task);
 const choices=parentChoices(board,task.id).filter(item=>[item.title,item.cloud].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 return <div className="small-modal task-parent-picker">
  <h2>Головная задача</h2>
  {current&&<p className="parent-current">Сейчас: {current.title}</p>}
  <label className="tag-search"><Search size={18}/><input autoFocus aria-label="Найти головную задачу" placeholder="Найти задачу или облако" value={query} onChange={event=>setQuery(event.target.value)}/></label>
  <button type="button" className="parent-clear" onClick={()=>onApply(null)}>Без головной задачи{!current&&<Check size={18}/>}</button>
  <div className="parent-choice-list">{choices.map(item=><button key={item.taskId} type="button" className="parent-choice" aria-pressed={current?.taskId===item.taskId} onClick={()=>onApply({taskId:item.taskId,title:item.title})}><CornerDownRight size={17}/><span><span>{item.title}</span><small>{item.cloud}{item.done?' · выполнено':''}</small></span>{current?.taskId===item.taskId&&<Check size={18}/>}</button>)}</div>
  {!choices.length&&<p>Подходящих задач не найдено.</p>}
  <div className="modal-actions"><button type="button" className="secondary" onClick={onCancel}>Отмена</button></div>
 </div>;
}
