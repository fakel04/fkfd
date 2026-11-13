import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOCUS_NOTE_ID, boardSchema, ensureFocusBoard, moveToFocus, returnFromFocus, sourceTitle } from '../app/board-model.ts';
const fixture = () => ({categories:['Работа'],notes:[{id:'idea',title:'Идея',text:'Текст заметки',color:'white',category:'Работа',pinned:false,archived:false,deleted:false,created:'2026-11-12',tasks:[{id:'a',text:'Первое',done:false},{id:'b',text:'Второе',done:false},{id:'c',text:'Третье',done:true}]}]});
const focus = board => board.notes.find(n=>n.id===FOCUS_NOTE_ID);
const original = board => board.notes.find(n=>n.id==='idea');
test('old boards gain one focus cloud without modifying existing notes',()=>{
 const board=fixture(), upgraded=ensureFocusBoard(board);
 assert.equal(upgraded.notes.length,2); assert.deepEqual(original(upgraded),board.notes[0]);
 assert.deepEqual(ensureFocusBoard(upgraded),upgraded);
});
test('move, API schema and reload preserve one task with source and original position',()=>{
 const start=fixture();let board=moveToFocus(start,'idea','b');
 assert.deepEqual(original(board).tasks.map(t=>t.id),['a','c']);
 assert.equal(focus(board).tasks[0].done,false);assert.equal(focus(board).tasks[0].focused,true);
 board=boardSchema.parse(JSON.parse(JSON.stringify(board)));
 assert.equal(sourceTitle(board,focus(board).tasks[0]),'Идея');
 board=returnFromFocus(board,'b');
 assert.deepEqual(original(board),start.notes[0]);assert.deepEqual(focus(board).tasks,[]);
 assert.equal(start.notes[0].tasks.length,3);
});
test('completion and edits in focus survive return; cloud field follows renamed source',()=>{
 let board=moveToFocus(fixture(),'idea','a');focus(board).tasks[0].done=true;focus(board).tasks[0].text='Изменённый текст';original(board).title='Новые идеи';
 assert.equal(sourceTitle(board,focus(board).tasks[0]),'Новые идеи');
 board=returnFromFocus(board,'a');assert.deepEqual(original(board).tasks[0],{id:'a',text:'Изменённый текст',done:true});
});
test('return restores archived or deleted original and handles missing source',()=>{
 for(const mode of ['archived','deleted','missing']){
  let board=moveToFocus(fixture(),'idea','b');
  if(mode==='missing')board.notes=board.notes.filter(n=>n.id!=='idea');else original(board)[mode]=true;
  board=returnFromFocus(board,'b');assert.equal(original(board).archived,false);assert.equal(original(board).deleted,false);assert.equal(original(board).tasks.some(t=>t.id==='b'),true);
 }
});
test('repeated activation and return never duplicate tasks',()=>{
 let board=fixture();for(let i=0;i<5;i++){board=moveToFocus(board,'idea','a');board=moveToFocus(board,'idea','a');assert.equal(focus(board).tasks.length,1);board=returnFromFocus(board,'a');board=returnFromFocus(board,'a');assert.equal(original(board).tasks.length,3)}
});
test('Todoist tags stay independent of source cloud even when their names match',()=>{
 const start=fixture();
 start.notes[0].tasks[0].todoist={id:'td-a',projectId:'td-p',description:'',labels:['Идея','жду'],priority:'p4',recurring:false};
 let board=boardSchema.parse(JSON.parse(JSON.stringify(moveToFocus(start,'idea','a'))));
 const task=focus(board).tasks[0];
 assert.equal(sourceTitle(board,task),'Идея');
 assert.deepEqual(task.todoist.labels,['Идея','жду']);
 original(board).title='Косметика';
 assert.equal(sourceTitle(board,task),'Косметика');
 assert.deepEqual(task.todoist.labels,['Идея','жду']);
 board=returnFromFocus(board,'a');
 assert.deepEqual(original(board).tasks[0].todoist.labels,['Идея','жду']);
 assert.equal(original(board).tasks[0].origin,undefined);
});
