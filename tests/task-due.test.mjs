import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boardSchema,moveToFocus,returnFromFocus,taskDueDate,taskLabels,taskSchema} from '../app/board-model.ts';
import {dueParts,localDate,makeDueDate,validDate} from '../app/task-due.ts';
import {readBoardTool} from '../app/mcp-tools.ts';
import {clampSwipe,settleSwipe} from '../app/swipe-offset.ts';

test('left and right swipes reveal different menus and small movements close them',()=>{
 assert.equal(clampSwipe(-400,176,88),-88);assert.equal(clampSwipe(400,176,88),176);
 assert.equal(settleSwipe(-30,176,88),-88);assert.equal(settleSwipe(55,176,88),176);
 assert.equal(settleSwipe(-10,176,88),0);assert.equal(settleSwipe(10,176,88),0);
 assert.equal(settleSwipe(-88+80,176,88),0);assert.equal(settleSwipe(176-160,176,88),0);
});
test('date-only values stay on their calendar day and optional time round-trips locally',()=>{
 assert.deepEqual(dueParts('2026-11-14'),{date:'2026-11-14',time:''});assert.equal(makeDueDate('2026-11-14',''),'2026-11-14');
 assert.deepEqual(dueParts(makeDueDate('2026-11-14','09:30')),{date:'2026-11-14',time:'09:30'});
 assert.equal(localDate(new Date(2026,10,14,0,15)),'2026-11-14');
 assert.ok(validDate('2028-02-29'));assert.ok(!validDate('2026-02-29'));assert.equal(makeDueDate('2026-11-14','25:30'),null);
 for(const dueDate of ['2026-02-30','not-a-date'])assert.equal(taskSchema.safeParse({id:'a',text:'a',done:false,dueDate}).success,false);
});
const fixture=()=>({categories:[],notes:[{id:'cloud',title:'Косметика',text:'',category:'',color:'white',pinned:false,archived:false,deleted:false,created:'2026-11-13',tasks:[{id:'a',text:'Первое',done:false,todoist:{id:'td-a',projectId:'p',description:'',labels:['идея'],dueDate:'2026-11-20',priority:'p4',recurring:false}},{id:'b',text:'Второе',done:false}]}]});
test('due dates and tags apply only to the selected task, survive save, focus and return',()=>{
 const board=fixture();board.notes[0].tasks[0].dueDate='2026-11-15';board.notes[0].tasks[0].labels=['жду'];
 let saved=boardSchema.parse(JSON.parse(JSON.stringify(moveToFocus(board,'cloud','a'))));
 const task=saved.notes.find(n=>n.id==='__focus_tasks__').tasks[0];
 assert.equal(taskDueDate(task),'2026-11-15');assert.deepEqual(taskLabels(task),['жду']);assert.equal(task.origin.noteId,'cloud');
 saved=returnFromFocus(saved,'a');assert.equal(taskDueDate(saved.notes.find(n=>n.id==='cloud').tasks[0]),'2026-11-15');
 assert.equal(taskDueDate(saved.notes.find(n=>n.id==='cloud').tasks[1]),null);assert.deepEqual(taskLabels(saved.notes.find(n=>n.id==='cloud').tasks[1]),[]);
 const result=readBoardTool('search_tasks',{query:'Первое'},saved,1);assert.equal(result.items[0].due_date,'2026-11-15');
});
test('removing a due date overrides imported dates; local tasks can have dates without Todoist metadata',()=>{
 const board=fixture();assert.equal(taskDueDate(board.notes[0].tasks[0]),'2026-11-20');
 board.notes[0].tasks[0].dueDate=null;board.notes[0].tasks[1].dueDate='2026-11-30';
 const saved=boardSchema.parse(JSON.parse(JSON.stringify(board)));
 assert.equal(taskDueDate(saved.notes[0].tasks[0]),null);assert.equal(taskDueDate(saved.notes[0].tasks[1]),'2026-11-30');
 const result=readBoardTool('get_cloud',{cloud_id:'cloud'},saved,1);assert.equal(result.tasks.items[0].dueDate,null);assert.equal(result.tasks.items[0].todoist.dueDate,undefined);assert.equal(result.tasks.items[1].dueDate,'2026-11-30');
});
