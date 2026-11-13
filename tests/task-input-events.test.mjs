import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachTaskInputEvents} from '../app/task-input-events.ts';
import {splitTask,splitTaskLines} from '../app/task-list-edit.ts';

// Exercise the actual native listeners, independently of React's onChange polyfill.
class Textarea extends EventTarget{
 constructor(value){super();this.value=value;this.selectionStart=value.length;this.selectionEnd=value.length;this.resizes=0;}
}
function inputEvent(type,properties={},cancelable=false){
 const event=new Event(type,{cancelable});
 for(const [key,value] of Object.entries(properties))Object.defineProperty(event,key,{value});
 return event;
}
function editor(text='',readOnly=false,count=1){
 let tasks=Array.from({length:count},(_,i)=>({id:String(i),text:i===0?text:'',done:false}));
 let active='0',seq=count;const fields=new Map(),cleanups=[];
 const createId=()=>String(seq++);
 function mount(){
  for(const task of tasks){
   if(fields.has(task.id))continue;
   const input=new Textarea(task.text);fields.set(task.id,input);
   cleanups.push(attachTaskInputEvents(input,()=>({
    value:tasks.find(item=>item.id===task.id).text,readOnly,
    onTaskBreak:edit=>commit(splitTask(tasks,task.id,edit,createId)),
    onTaskLines:(value,caret)=>commit(splitTaskLines(tasks,task.id,value,caret,createId))
   }),()=>input.resizes++));
  }
 }
 function commit(result){
  if(!result)return;
  const previous=tasks;tasks=result.tasks;
  for(const task of tasks){
   // Model React leaving an unchanged controlled value untouched (empty -> empty).
   if(fields.has(task.id)&&previous.find(item=>item.id===task.id)?.text!==task.text)fields.get(task.id).value=task.text;
  }
  mount();active=result.focusId;fields.get(active).selectionStart=result.focusOffset;fields.get(active).selectionEnd=result.focusOffset;
 }
 mount();
 return {get tasks(){return tasks},get input(){return fields.get(active)},fields,cleanup:()=>cleanups.forEach(fn=>fn())};
}
function returnKey(harness,{cancelable=true,isComposing=false,inputType='insertLineBreak'}={}){
 const input=harness.input;
 const event=inputEvent('beforeinput',{inputType,isComposing},cancelable);
 input.dispatchEvent(event);
 if(!event.defaultPrevented){
  const caret=input.selectionStart;
  input.value=input.value.slice(0,caret)+'\n'+input.value.slice(input.selectionEnd);
  input.selectionStart=input.selectionEnd=caret+1;
  input.dispatchEvent(inputEvent('input',{inputType,isComposing}));
 }
 return event;
}
test('repeated empty Return without keydown creates exactly one new task per press',()=>{
 for(const cancelable of [true,false]){
  const h=editor('');
  for(let i=0;i<6;i++)returnKey(h,{cancelable,isComposing:true,inputType:i%2?'insertParagraph':'insertLineBreak'});
  assert.equal(h.tasks.length,7);assert.deepEqual(h.tasks.map(task=>task.text),Array(7).fill(''));
  for(const input of h.fields.values())assert.equal(input.value,'');
  assert.equal(h.input.selectionStart,0);h.cleanup();
 }
});
test('input fallback ignores unreliable event labels and clears old empty textarea height',()=>{
 const h=editor(''),old=h.input;
 old.value='\n';old.selectionStart=0;old.selectionEnd=0;
 old.dispatchEvent(inputEvent('input',{inputType:'insertCompositionText',isComposing:true}));
 assert.deepEqual(h.tasks.map(task=>task.text),['','']);assert.equal(old.value,'');assert.ok(old.resizes>0);
 h.cleanup();
});
test('several pasted/composed paragraphs become independent tasks including every empty item',()=>{
 for(const type of ['input','compositionend']){
  const h=editor(''),input=h.input;
  input.value='Арл\n\nАр\n\nНоо\n';input.selectionStart=input.selectionEnd=input.value.length;
  input.dispatchEvent(inputEvent(type,{inputType:'insertFromPaste',isComposing:true}));
  assert.deepEqual(h.tasks.map(task=>task.text),['Арл','','Ар','','Ноо','']);
  assert.equal(input.value,'Арл');assert.equal(h.input.value,'');h.cleanup();
 }
});
test('composition without a newline does not create a task or interrupt ordinary input',()=>{
 const h=editor(''),input=h.input;input.value='Привет';
 const event=inputEvent('input',{inputType:'insertCompositionText',isComposing:true});input.dispatchEvent(event);
 assert.equal(h.tasks.length,1);assert.equal(input.value,'Привет');assert.equal(event.defaultPrevented,false);h.cleanup();
});
test('selection Return creates two tasks and restores the cursor before the remainder',()=>{
 const h=editor('Первое / Второе');h.input.selectionStart=6;h.input.selectionEnd=9;
 returnKey(h,{isComposing:true});assert.deepEqual(h.tasks.map(task=>task.text),['Первое','Второе']);assert.equal(h.input.value,'Второе');assert.equal(h.input.selectionStart,0);h.cleanup();
});
test('full list rejects the new row while restoring the DOM and retaining existing text',()=>{
 const h=editor('Текст',false,500),input=h.input;
 returnKey(h,{cancelable:false});assert.equal(h.tasks.length,500);assert.equal(input.value,'Текст');h.cleanup();
});
test('read-only fields and detached listeners cannot edit the checklist',()=>{
 const readOnly=editor('',true);const event=inputEvent('beforeinput',{inputType:'insertLineBreak'},true);readOnly.input.dispatchEvent(event);
 assert.equal(event.defaultPrevented,false);assert.equal(readOnly.tasks.length,1);readOnly.cleanup();
 const h=editor('');h.cleanup();h.input.dispatchEvent(inputEvent('beforeinput',{inputType:'insertLineBreak'},true));assert.equal(h.tasks.length,1);
});
