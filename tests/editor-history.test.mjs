import test from 'node:test';
import assert from 'node:assert/strict';
import {editorHistoryReducer as reduce,emptyHistory} from '../app/editor-history.ts';
import {splitTask} from '../app/task-list-edit.ts';
import {noteEdit,mergeBoards,assertBoardIntegrity} from '../app/board-merge.ts';

const task=(id,text=id)=>({id,text,done:false});
const note=(id='cloud',tasks=[task('a')])=>({id,title:'Мысли',text:'',tasks,color:'white',category:'',pinned:false,archived:false,deleted:false,created:'2026'});
const edit=(state,value,group,at=0)=>reduce(state,{type:'edit',value,group,at});
const undo=state=>reduce(state,{type:'undo'});
const redo=state=>reduce(state,{type:'redo'});

test('typing a word is one undo step and redo restores it exactly',()=>{
 const original=note();let history=emptyHistory(original);
 for(const [index,text] of ['м','мы','мыс','мысль'].entries())history=edit(history,n=>({...n,tasks:[{...n.tasks[0],text}]}),'task:a',index*100);
 assert.equal(history.past.length,1);history=undo(history);assert.deepEqual(history.value,original);
 assert.equal(redo(history).value.tasks[0].text,'мысль');
 assert.equal(original.tasks[0].text,'a');
});
test('each Return including repeated empty tasks is independently reversible',()=>{
 let history=emptyHistory(note('cloud',[task('a','Первая')])),id='a';
 for(let i=0;i<3;i++){
  const current=history.value.tasks.find(t=>t.id===id);
  const split=splitTask(history.value.tasks,id,{value:current.text,start:current.text.length,end:current.text.length},()=>`new-${i}`);
  history=edit(history,{...history.value,tasks:split.tasks});id=split.focusId;
 }
 const final=history.value;
 for(const length of [3,2,1]){history=undo(history);assert.equal(history.value.tasks.length,length)}
 for(const length of [2,3,4]){history=redo(history);assert.equal(history.value.tasks.length,length)}
 assert.deepEqual(history.value,final);assert.deepEqual(final.tasks.map(t=>t.text),['Первая','','','']);
});
test('pause, another field, caret movement and structural actions separate typing groups',()=>{
 let history=emptyHistory(note());
 history=edit(history,n=>({...n,title:'A'}),'title',0);
 history=edit(history,n=>({...n,title:'AB'}),'title',900);
 history=edit(history,n=>({...n,text:'X'}),'text',950);
 history=reduce(history,{type:'break'});
 history=edit(history,n=>({...n,text:'XY'}),'text',980);
 history=edit(history,n=>({...n,pinned:true}),undefined,1000);
 history=edit(history,n=>({...n,text:'XYZ'}),'text',1020);
 const expected=[['AB','XY',true],['AB','XY',false],['AB','X',false],['AB','',false],['A','',false],['Мысли','',false]];
 for(const values of expected){history=undo(history);assert.deepEqual([history.value.title,history.value.text,history.value.pinned],values)}
});
test('a continuous long typing session is bounded into undoable chunks',()=>{
 let history=emptyHistory(note());
 for(let i=0;i<30;i++)history=edit(history,n=>({...n,text:n.text+'a'}),'text',i*500);
 assert.equal(history.past.length,3);assert.equal(undo(history).value.text.length,20);
});
test('checkbox, tags, date, parent, description, pin, color and order roundtrip together',()=>{
 const original=note('cloud',[task('a'),task('b')]);let history=emptyHistory(original);
 for(const changes of [{done:true},{labels:['жду']},{dueDate:'2026-11-13'},{parent:{taskId:'b',title:'b'}},{description:'Две\nстроки'},{pinned:true}]){
  history=edit(history,n=>({...n,tasks:n.tasks.map(t=>t.id==='a'?{...t,...changes}:t)}));
 }
 history=edit(history,n=>({...n,color:'peach',tasks:[...n.tasks].reverse()}));
 const final=history.value;
 for(let i=0;i<7;i++)history=undo(history);
 assert.deepEqual(history.value,original);
 for(let i=0;i<7;i++)history=redo(history);
 assert.deepEqual(history.value,final);assertBoardIntegrity({categories:[],notes:[final]});
});
test('editing after undo clears redo but no-op edits do not',()=>{
 let history=edit(emptyHistory(note()),n=>({...n,text:'first'}),'text');
 history=undo(history);
 history=edit(history,structuredClone(history.value));assert.equal(history.future.length,1);
 history=edit(history,n=>({...n,text:'replacement'}),'text');assert.equal(history.future.length,0);
 assert.equal(redo(history),history);assert.equal(undo(history).value.text,'');
});
test('opening or closing a cloud and committing a move establish a fresh baseline',()=>{
 const changed=edit(emptyHistory(note()),n=>({...n,title:'Changed'}));
 for(const history of [reduce(changed,{type:'reset',value:note()}),edit(changed,note('other')),edit(changed,null)]){
  assert.equal(history.past.length,0);assert.equal(history.future.length,0);assert.equal(undo(history),history);
 }
});
test('undo history is capped without losing the current draft',()=>{
 let history=emptyHistory(note());
 for(let i=0;i<120;i++)history=edit(history,n=>({...n,text:String(i)}));
 assert.equal(history.past.length,100);
 for(let i=0;i<100;i++)history=undo(history);
 assert.equal(history.value.text,'19');assert.equal(undo(history),history);
 for(let i=0;i<100;i++)history=redo(history);
 assert.equal(history.value.text,'119');
});
test('saving after undo preserves independent changes and task moves from another device',()=>{
 const original=note('cloud',[task('a'),task('b')]);let history=emptyHistory(original);
 history=edit(history,n=>({...n,tasks:n.tasks.map(t=>t.id==='a'?{...t,text:'Changed here'}:t)}));
 history=edit(history,n=>({...n,tasks:n.tasks.map(t=>t.id==='a'?{...t,done:true}:t)}));
 history=undo(history);
 const remote={categories:[],notes:[note('cloud',[task('a')]),note('other',[{...task('b'),text:'Changed elsewhere'}])]};
 const operation=noteEdit(remote,original,history.value);
 const merged=mergeBoards(operation.base,operation.data,remote);
 assert.equal(merged.conflicts.length,0);assertBoardIntegrity(merged.data);
 assert.deepEqual(merged.data.notes[0].tasks,[task('a','Changed here')]);
 assert.deepEqual(merged.data.notes[1].tasks,[task('b','Changed elsewhere')]);
});
