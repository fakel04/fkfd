import test from 'node:test';
import assert from 'node:assert/strict';
import { boardSchema, focusNote, moveToFocus, moveTaskToCloud, pinnedFirst } from '../app/board-model.ts';
const note=(id,tasks=[])=>({id,title:id,text:'',tasks,color:'white',category:'',pinned:false,archived:false,deleted:false,created:'2026-11-13'});
const task={id:'task',text:'Дело',done:false,pinned:true};
test('pin survives save and pinned display preserves manual order within each group',()=>{
 const tasks=[{...task,id:'a',pinned:false},{...task,id:'b'},{...task,id:'c'},{...task,id:'d',pinned:false}];
 const parsed=boardSchema.parse({categories:[],notes:[note('a',tasks)]});
 assert.deepEqual(pinnedFirst(parsed.notes[0].tasks).map(t=>t.id),['b','c','a','d']);
 assert.deepEqual(tasks.map(t=>t.id),['a','b','c','d']);
});
test('move to focus and another cloud preserves completion/pin, clears source tag, never duplicates',()=>{
 const board={categories:[],notes:[focusNote(),note('a',[task]),note('b')]};
 const focused=moveToFocus(board,'a','task');
 const next=moveTaskToCloud(focused,'__focus_tasks__','task','b');
 assert.deepEqual(next.notes.find(n=>n.id==='b').tasks,[task]);
 assert.equal(next.notes.flatMap(n=>n.tasks).length,1);
 assert.deepEqual(boardSchema.parse(JSON.parse(JSON.stringify(next))),next);
 assert.equal(moveTaskToCloud(next,'b','task','b'),next);
 assert.equal(moveTaskToCloud(next,'b','task','missing'),next);
});
test('choosing original cloud restores former position',()=>{
 const board={categories:[],notes:[focusNote(),note('a',[{...task,id:'first'},task,{...task,id:'last'}])]};
 const next=moveTaskToCloud(moveToFocus(board,'a','task'),'__focus_tasks__','task','a');
 assert.deepEqual(next.notes.find(n=>n.id==='a').tasks.map(t=>t.id),['first','task','last']);
});
