import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeTodoist} from '../app/todoist-import.ts';
import {boardSchema,moveToFocus,returnFromFocus,FOCUS_NOTE_ID} from '../app/board-model.ts';
const board=()=>({categories:[],notes:[{id:'mine',title:'Моя заметка',text:'Сохранить',tasks:[{id:'mine-task',text:'Своя задача',done:true}],color:'peach',category:'',pinned:true,archived:false,deleted:false,created:'2026-01-01'}]});
const input=()=>({importId:'batch',projects:[{id:'p',name:'Проект',description:'Общее описание',childOrder:0,sections:[{id:'s',name:'Раздел',sectionOrder:1}]}],tasks:[{id:'child',content:'Подзадача',description:'Описание',projectId:'p',parentId:'parent',checked:false,labels:['идея'],dueDate:'2026-12-01',priority:'p2',recurring:false},{id:'parent',content:'Родитель',description:'',projectId:'p',sectionId:'s',checked:false,labels:[],priority:'p4',recurring:false}]});
test('preserves the existing board and groups parent before child, inheriting section',()=>{
 const old=board();const result=mergeTodoist(old,input(),'2026-11-12');
 assert.deepEqual(result.board.notes.find(n=>n.id==='mine'),old.notes[0]);assert.equal(old.notes.length,1);
 const imported=result.board.notes.find(n=>n.todoist);assert.equal(imported.title,'Раздел');assert.equal(imported.category,'Проект');
 assert.deepEqual(imported.tasks.map(t=>t.text),['Родитель','Подзадача']);
 assert.equal(imported.tasks[1].todoist.parentTitle,'Родитель');assert.equal(imported.tasks[1].todoist.dueDate,'2026-12-01');assert.equal(result.receipt.taskCount,2);
});
test('API roundtrip, focus selection, editing and return keep imported details',()=>{
 let result=mergeTodoist(board(),input(),'2026-11-12').board;
 result=boardSchema.parse(JSON.parse(JSON.stringify(result)));
 result=moveToFocus(result,'todoist:p:s','todoist:child');
 const task=result.notes.find(n=>n.id===FOCUS_NOTE_ID).tasks[0];task.text='Новое имя';task.done=true;
 result=returnFromFocus(result,task.id);const restored=result.notes.find(n=>n.id==='todoist:p:s').tasks.find(t=>t.id===task.id);
 assert.equal(restored.text,'Новое имя');assert.equal(restored.done,true);assert.equal(restored.todoist.description,'Описание');assert.deepEqual(restored.todoist.labels,['идея']);
});
test('retries and later batches do not duplicate, reset local edits or resurrect removed tasks',()=>{
 let result=mergeTodoist(board(),input(),'2026-11-12').board;
 const note=result.notes.find(n=>n.todoist);note.tasks[0].text='Местное изменение';note.tasks.splice(1,1);
 assert.deepEqual(mergeTodoist(result,input(),'2026-11-13').board,result);
 const next=input();next.importId='later';const merged=mergeTodoist(result,next,'2026-11-13');
 assert.equal(merged.receipt.taskCount,0);assert.equal(merged.board.notes.find(n=>n.todoist).tasks[0].text,'Местное изменение');assert.equal(merged.board.notes.find(n=>n.todoist).tasks.length,1);
});
test('missing projects and parents fail before changing the board',()=>{
 const old=board();const broken=input();broken.tasks[0].parentId='missing';assert.throws(()=>mergeTodoist(old,broken,'2026-11-12'));assert.equal(old.notes.length,1);
});
