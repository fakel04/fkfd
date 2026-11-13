import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splitTask,splitTaskLines,expandTaskLines,prepareTaskList} from '../app/task-list-edit.ts';
import {boardSchema,moveToFocus,returnFromFocus,pinnedFirst} from '../app/board-model.ts';

const task=(id,text,extra={})=>({id,text,done:false,...extra});
const note=tasks=>({id:'cloud',title:'На сегодня',text:'',tasks,color:'peach',category:'',pinned:false,archived:false,deleted:false,created:'2026-11-13'});
test('successive Return presses produce separate empty checklist items and unique focus targets',()=>{
 let tasks=[task('first','Первое')],id='first';
 for(let i=0;i<4;i++){
  const current=tasks.find(item=>item.id===id);
  const result=splitTask(tasks,id,{value:current.text,start:current.text.length,end:current.text.length},()=>`new-${i}`);
  tasks=result.tasks;id=result.focusId;
 }
 assert.deepEqual(tasks.map(item=>item.text),['Первое','','','','']);
 assert.equal(new Set(tasks.map(item=>item.id)).size,5);assert.equal(id,'new-3');
});
test('Return in the middle splits text at the caret and keeps metadata on the original task',()=>{
 const original=task('first','Купить молоко',{labels:['жду'],description:'Магазин',dueDate:'2026-11-13',parent:{taskId:'p',title:'Покупки'}});
 const neighbor=task('neighbor','Не менять');
 const result=splitTask([original,neighbor],'first',{value:original.text,start:7,end:7},()=> 'new');
 assert.deepEqual(result.tasks.map(item=>item.text),['Купить ','молоко','Не менять']);
 assert.deepEqual(result.tasks[0],{...original,text:'Купить '});
 assert.deepEqual(result.tasks[1],task('new','молоко'));assert.equal(result.tasks[2],neighbor);
});
test('selected text is replaced by a checklist break without duplicating its content',()=>{
 const result=splitTask([task('a','Первое / Второе')],'a',{value:'Первое / Второе',start:6,end:9},()=> 'b');
 assert.deepEqual(result.tasks.map(item=>item.text),['Первое','Второе']);
});
test('a new row remains next to its pinned source despite the visual pinned-first order',()=>{
 const result=splitTask([task('ordinary','Обычное'),task('pinned','Закреплённое',{pinned:true}),task('pinned2','Другое',{pinned:true})],'pinned',{value:'Закреплённое',start:12,end:12},()=> 'new');
 assert.deepEqual(pinnedFirst(result.tasks).map(item=>item.id),['pinned','new','pinned2','ordinary']);
});
test('input fallback splits every literal newline, including empty tasks and misplaced carets',()=>{
 for(const [previous,value,caret,expected] of [
  ['','\n',1,['','']],['Первое','Первое\n',7,['Первое','']],['Привет мир','Привет\n мир',7,['Привет',' мир']],['','\r\n',2,['','']]
 ]){
  const result=splitTaskLines([task('a',previous)],'a',value,caret,()=> 'b');
  assert.deepEqual(result.tasks.map(item=>item.text),expected);
 }
 let id=0;const result=splitTaskLines([task('a','')],'a','\n\nАр\n',0,()=>String(++id));
 assert.deepEqual(result.tasks.map(item=>item.text),['','','Ар','']);assert.equal(result.focusId,'a');
 assert.equal(splitTaskLines([task('a','Тест')],'a','Текст',5,()=> 'b'),null);
});
test('empty separators survive save/API roundtrip and moving a neighboring task to focus and back',()=>{
 const rows=[task('a','Первое'),task('empty1',''),task('empty2','   '),task('b','Второе'),task('trailing','')];
 let board=boardSchema.parse({categories:[],notes:[note(prepareTaskList(rows))]});
 board=boardSchema.parse(JSON.parse(JSON.stringify(returnFromFocus(moveToFocus(board,'cloud','b'),'b'))));
 assert.deepEqual(board.notes.find(item=>item.id==='cloud').tasks.map(item=>[item.id,item.text]),[
  ['a','Первое'],['empty1',''],['empty2',''],['b','Второе'],['trailing','']
 ]);
});
test('legacy paragraphs expand in the editor draft without touching descriptions or the source array',()=>{
 const rows=[task('a','Арл'),task('b','\nАр\n',{description:'Описание\nостаётся абзацами',labels:['идея']})];
 const original=structuredClone(rows);let next=0;
 const result=expandTaskLines(rows,()=>`new-${++next}`);
 assert.deepEqual(result.map(item=>item.text),['Арл','','Ар','']);
 assert.deepEqual(rows,original);assert.equal(result[1].id,'b');assert.equal(result[1].description,'Описание\nостаётся абзацами');assert.deepEqual(result[1].labels,['идея']);
 assert.deepEqual(expandTaskLines(result),result);
});
test('Return in the tasks cloud preserves origin only on the original task, including repeated empty Returns',()=>{
 const origin={noteId:'cloud',title:'На сегодня',color:'peach',category:'',index:0};
 const original=task('a','Первое',{focused:true,origin});
 let tasks=[original],id='a';
 for(let i=0;i<4;i++){
  const current=tasks.find(item=>item.id===id);
  const result=splitTask(tasks,id,{value:current.text,start:current.text.length,end:current.text.length},()=>`new-${i}`);
  tasks=result.tasks;id=result.focusId;
 }
 assert.deepEqual(tasks[0],original);
 assert.deepEqual(tasks.slice(1).map(item=>item.origin),[undefined,undefined,undefined,undefined]);
 const board=boardSchema.parse(JSON.parse(JSON.stringify({categories:[],notes:[note([]),{...note(tasks),id:'__focus_tasks__',kind:'focus'}]})));
 assert.equal(returnFromFocus(board,'new-0'),board);
 const returned=returnFromFocus(board,'a');
 assert.equal(returned.notes.find(item=>item.id==='cloud').tasks[0].id,'a');
 assert.equal(returned.notes.find(item=>item.id==='__focus_tasks__').tasks.length,4);
});
test('mobile input fallback and legacy paragraph expansion do not spread the source cloud',()=>{
 const origin={noteId:'cloud',title:'На сегодня',color:'peach',category:'',index:0};
 const original=task('a','Первое',{focused:true,origin});let id=0;
 const result=splitTaskLines([original],'a','Первое\n\nВторое\n',16,()=>`new-${++id}`);
 const expanded=expandTaskLines([{...original,text:'Первое\n\nВторое\n'}],()=>`legacy-${++id}`);
 for(const rows of [result.tasks,expanded]){
  assert.deepEqual(rows.map(item=>item.text),['Первое','','Второе','']);
  assert.deepEqual(rows[0].origin,origin);
  assert.ok(rows.slice(1).every(item=>!item.origin));
 }
});
test('unknown targets and full clouds do not insert items or lose text',()=>{
 const rows=Array.from({length:500},(_,i)=>task(String(i),'Строка'));
 assert.equal(splitTask(rows,'0',{value:'Строка',start:6,end:6},()=> 'new'),null);
 assert.equal(splitTask([],'missing',{value:'',start:0,end:0},()=> 'new'),null);
});
