'use client';
import {useState} from 'react';
import {CalendarDays,Check} from 'lucide-react';
import {dueParts,localDate,makeDueDate} from './task-due';

export function DuePicker({value,onApply,onCancel}:{value:string|null;onApply:(due:string|null)=>void;onCancel:()=>void}){
 const initial=dueParts(value);
 const [date,setDate]=useState(initial.date),[time,setTime]=useState(initial.time);
 function quick(days:number){const day=new Date();day.setDate(day.getDate()+days);setDate(localDate(day))}
 const valid=makeDueDate(date,time);
 return <form className="small-modal due-picker" onSubmit={event=>{event.preventDefault();if(valid)onApply(date===initial.date&&time===initial.time?value:valid)}}>
  <h2>Срок задачи</h2>
  <div className="due-quick"><button type="button" onClick={()=>quick(0)}>Сегодня</button><button type="button" onClick={()=>quick(1)}>Завтра</button></div>
  <label className="due-field"><span><CalendarDays size={16}/>Дата</span><input autoFocus required type="date" aria-label="Дата выполнения" value={date} onChange={event=>setDate(event.target.value)}/></label>
  <label className="due-field"><span>Время · необязательно</span><input type="time" aria-label="Время выполнения" value={time} onChange={event=>setTime(event.target.value)}/></label>
  {time&&<button type="button" className="text-button" onClick={()=>setTime('')}>Убрать время</button>}
  <div className="modal-actions"><button type="button" className="text-button" onClick={()=>onApply(null)}>Без срока</button><button type="button" className="text-button" onClick={onCancel}>Отмена</button><button type="submit" className="primary" disabled={!valid}><Check size={17}/>Применить</button></div>
 </form>;
}
