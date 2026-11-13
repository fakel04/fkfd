'use client';
import { CornerDownRight } from 'lucide-react';
import type { ReactNode } from 'react';
import {taskDescription,type Task} from './board-model';

// Keep imported links usable without executing HTML from task content.
export function TaskText({text}:{text:string}){
 const parts:ReactNode[]=[];const pattern=/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]+)/g;
 let start=0;for(const match of text.matchAll(pattern)){
  const index=match.index!;parts.push(text.slice(start,index));
  const href=match[2]||match[3];parts.push(<a key={index} href={href} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>{match[1]||href}</a>);start=index+match[0].length;
 }
 parts.push(text.slice(start));return <>{parts}</>;
}
export function TaskDetails({task,parentTitle}:{task:Task;parentTitle?:string}){
 const description=taskDescription(task);if(!parentTitle&&!description)return null;
 return <div className="task-details">
  {parentTitle&&<span className="task-parent" title={'Головная задача: '+parentTitle}><CornerDownRight size={12}/><span>{parentTitle}</span></span>}
  {description&&<details className="task-description"><summary>Описание</summary><p><TaskText text={description}/></p></details>}
 </div>;
}
