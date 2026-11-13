'use client';
import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';
import {hasTaskBreak,type TaskBreak} from './task-list-edit';
import {attachTaskInputEvents} from './task-input-events';
type Props=TextareaHTMLAttributes<HTMLTextAreaElement>&{
 onTaskBreak?:(edit:TaskBreak)=>void;
 onTaskLines?:(value:string,caret:number)=>void;
};
export function TaskInput({onTaskBreak,onTaskLines,...props}:Props){
 const ref=useRef<HTMLTextAreaElement>(null);
 const latest=useRef({props,onTaskBreak,onTaskLines});latest.current={props,onTaskBreak,onTaskLines};
 const resize=()=>{const el=ref.current;if(el){el.style.height='auto';el.style.height=el.scrollHeight+'px';}};
 useLayoutEffect(resize,[props.value]);
 useLayoutEffect(()=>{const el=ref.current;if(!el)return;let width=el.clientWidth;const observer=new ResizeObserver(()=>{if(el.clientWidth!==width){width=el.clientWidth;resize()}});observer.observe(el);return()=>observer.disconnect()},[]);
 useLayoutEffect(()=>{
  const el=ref.current;if(!el)return;
  return attachTaskInputEvents(el,()=>{
   const current=latest.current;
   return {value:String(current.props.value??''),readOnly:current.props.readOnly,onTaskBreak:current.onTaskBreak,onTaskLines:current.onTaskLines};
  },resize);
 },[]);
 return <textarea {...props} rows={1} ref={ref} className="task-input" enterKeyHint="enter"
  onChange={event=>{
   // Defensive fallback: no input path can save a literal newline as a task title.
   if(onTaskLines&&!props.readOnly&&hasTaskBreak(event.currentTarget.value)){
    onTaskLines(event.currentTarget.value,event.currentTarget.selectionStart);
    event.currentTarget.value=String(latest.current.props.value??'');resize();return;
   }
   props.onChange?.(event);
  }}/>;
}
