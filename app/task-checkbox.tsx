'use client';
import { Check } from 'lucide-react';
export function TaskCheckbox({done,focused=false,label,disabled=false,onToggleDone}: {
 done:boolean;focused?:boolean;label:string;disabled?:boolean;onToggleDone:()=>void;
}) {
 return <button type="button" role="checkbox" aria-checked={done} aria-label={label}
  className={'checkbox task-checkbox'+(focused?' focused-checkbox':'')} disabled={disabled}
  onClick={event=>{event.stopPropagation();onToggleDone()}}>
  {done&&<Check size={13} strokeWidth={3}/>}
 </button>;
}
