import {hasTaskBreak,type TaskBreak} from './task-list-edit.ts';

type State={value:string;readOnly?:boolean;onTaskBreak?:(edit:TaskBreak)=>void;onTaskLines?:(value:string,caret:number)=>void};

/** The textarea may wrap visually, but actual newline characters always create tasks. */
export function attachTaskInputEvents(input:HTMLTextAreaElement,read:()=>State,resize:()=>void){
 const restore=()=>{
  // The first row can remain empty before and after Return. React may see no value
  // change, so also clear the browser's inserted newline and its enlarged height.
  const value=read().value;
  if(input.value!==value)input.value=value;
  resize();
 };
 const normalize=(event:Event)=>{
  const state=read();
  if(state.readOnly||!state.onTaskLines||!hasTaskBreak(input.value))return;
  event.stopPropagation();
  state.onTaskLines(input.value,input.selectionStart);
  restore();
 };
 const beforeInput=(event:InputEvent)=>{
  const state=read();
  if(state.readOnly||!state.onTaskBreak||event.defaultPrevented)return;
  if(event.inputType!=='insertLineBreak'&&event.inputType!=='insertParagraph')return;
  if(!event.cancelable)return; // The native input listener will split the actual value.
  event.preventDefault();
  // Do not inspect Shift, keyCode, or composition flags for an explicit line break:
  // mobile keyboards report them inconsistently, including on empty textareas.
  state.onTaskBreak({value:input.value,start:input.selectionStart,end:input.selectionEnd});
  restore();
 };
 input.addEventListener('beforeinput',beforeInput);
 input.addEventListener('input',normalize);
 input.addEventListener('compositionend',normalize);
 return()=>{
  input.removeEventListener('beforeinput',beforeInput);
  input.removeEventListener('input',normalize);
  input.removeEventListener('compositionend',normalize);
 };
}
