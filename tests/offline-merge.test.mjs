import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeBoards,assertBoardIntegrity,noteEdit} from '../app/board-merge.ts';
import {moveToFocus,returnFromFocus,ensureFocusBoard} from '../app/board-model.ts';
const task=(id,text=id)=>({id,text,done:false});
const note=(id,tasks=[])=>({id,title:id,text:'',color:'white',category:'',created:'2026',pinned:false,archived:false,deleted:false,tasks});
const base=()=>({categories:[],notes:[note('a',[task('x'),task('y')]),note('b',[task('z')])]});
const edit=(b,f)=>{const v=structuredClone(b);f(v);return v};
test('different tasks and different fields merge without replacing collaborators data',()=>{
 const b=base(),l=edit(b,v=>v.notes[0].tasks[0].text='local'),r=edit(b,v=>{v.notes[0].tasks[0].done=true;v.notes[1].tasks[0].text='remote'});
 const m=mergeBoards(b,l,r);assert.equal(m.conflicts.length,0);assert.equal(m.data.notes[0].tasks[0].text,'local');assert.equal(m.data.notes[0].tasks[0].done,true);assert.equal(m.data.notes[1].tasks[0].text,'remote');
});
test('same field retains three versions and explicit decisions resolve',()=>{
 const b=base(),l=edit(b,v=>v.notes[0].tasks[0].text='local'),r=edit(b,v=>v.notes[0].tasks[0].text='remote');
 const m=mergeBoards(b,l,r);assert.equal(m.conflicts.length,1);const c=m.conflicts[0];assert.deepEqual([c.base,c.local,c.remote],['x','local','remote']);
 assert.equal(mergeBoards(b,l,r,{[c.key]:'remote'}).data.notes[0].tasks[0].text,'remote');
 assert.equal(mergeBoards(b,l,r,{[c.key]:'local'}).conflicts.length,0);
});
test('a move and an unrelated text edit merge; returning preserves task origin',()=>{
 const b=ensureFocusBoard(base()),l=moveToFocus(b,'a','x'),r=edit(b,v=>v.notes[1].tasks[0].text='remote');
 const m=mergeBoards(b,l,r);assert.equal(m.conflicts.length,0);const focus=m.data.notes[0];assert.equal(focus.tasks[0].text,'remote');assert.equal(focus.tasks[0].origin.noteId,'a');
 const returned=returnFromFocus(m.data,'x');assert.equal(returned.notes[1].tasks[0].text,'remote');assert.equal(returned.notes[1].tasks[0].origin,undefined);
});
test('concurrent inserts are preserved and base order unaffected',()=>{
 const b=base(),l=edit(b,v=>v.notes[0].tasks.splice(1,0,task('local'))),r=edit(b,v=>v.notes[0].tasks.splice(1,0,task('remote')));
 const m=mergeBoards(b,l,r);assert.equal(m.conflicts.length,0);assert.deepEqual(new Set(m.data.notes[0].tasks.map(t=>t.id)),new Set(['x','y','local','remote']));
 assert.equal(m.data.notes[0].tasks[0].id,'x');assert.equal(m.data.notes[0].tasks.at(-1).id,'y');
});
test('different reorders produce a conflict instead of silent overwrite',()=>{
 const b=edit(base(),v=>v.notes[0].tasks.push(task('third'))),l=edit(b,v=>v.notes[0].tasks.reverse()),r=edit(b,v=>v.notes[0].tasks.push(v.notes[0].tasks.shift()));
 assert.equal(mergeBoards(b,l,r).conflicts[0].field,'Порядок');
});
test('delete versus edit conflicts in both directions, and remote choice does not resurrect a task',()=>{
 const b=base(),removed=edit(b,v=>v.notes[0].tasks.shift()),changed=edit(b,v=>v.notes[0].tasks[0].text='new');
 for(const [l,r] of [[removed,changed],[changed,removed]])assert.equal(mergeBoards(b,l,r).conflicts.length,1);
 const m=mergeBoards(b,changed,removed);const resolved=mergeBoards(b,changed,removed,{[m.conflicts[0].key]:'remote'});assert.equal(resolved.data.notes[0].tasks.some(t=>t.id==='x'),false);
});
test('cloud deletion versus child edit requires a decision',()=>{
 const b=base(),removed=edit(b,v=>v.notes[0].deleted=true),changed=edit(b,v=>v.notes[0].tasks[0].text='new');
 const m=mergeBoards(b,removed,changed);assert.equal(m.conflicts.length,1);assert.equal(mergeBoards(b,removed,changed,{[m.conflicts[0].key]:'remote'}).data.notes[0].deleted,false);
 const reverse=mergeBoards(b,changed,removed);assert.ok(reverse.conflicts.length);const choices=Object.fromEntries(reverse.conflicts.map(c=>[c.key,'remote']));assert.equal(mergeBoards(b,changed,removed,choices).data.notes[0].tasks[0].text,'x');
});
test('catalog updates and independent tags retain both additions',()=>{
 const b=edit(base(),v=>v.notes[0].tasks[0].labels=['old']),l=edit(b,v=>{v.notes[0].tasks[0].labels.push('local');v.categories.push('new')}),r=edit(b,v=>v.notes[0].tasks[0].labels.push('remote'));
 const m=mergeBoards(b,l,r);assert.equal(m.conflicts.length,0);assert.deepEqual(new Set(m.data.notes[0].tasks[0].labels),new Set(['old','local','remote']));assert.deepEqual(m.data.categories,['new']);
});
test('blank tasks, duplicate id validation and parent cycle validation',()=>{
 const b=base();const l=edit(b,v=>v.notes[0].tasks.push(task('empty','')));assert.equal(mergeBoards(b,l,b).data.notes[0].tasks.at(-1).text,'');
 assert.throws(()=>assertBoardIntegrity(edit(b,v=>v.notes[0].tasks.push(task('x')))));
 assert.throws(()=>assertBoardIntegrity(edit(b,v=>{v.notes[0].tasks[0].parent={taskId:'y',title:'y'};v.notes[0].tasks[1].parent={taskId:'x',title:'x'}})));
});
test('an open editor saves only what it changed, retaining remote fields',()=>{
 const b=base(),current=edit(b,v=>{v.notes[0].tasks[1].text='remote';v.notes[0].color='blue'});const draft=edit(b,v=>v.notes[0].tasks[0].text='local').notes[0];
 const op=noteEdit(current,b.notes[0],draft);const m=mergeBoards(op.base,op.data,current);assert.equal(m.conflicts.length,0);assert.equal(m.data.notes[0].color,'blue');assert.equal(m.data.notes[0].tasks[1].text,'remote');
});
test('editor text changes follow a remotely moved task without duplicating its identity',()=>{
 const b=ensureFocusBoard(base()),current=moveToFocus(b,'a','x');const original=b.notes.find(n=>n.id==='a'),draft=structuredClone(original);draft.tasks[0].text='local edit';
 const op=noteEdit(current,original,draft);assertBoardIntegrity(op.base);assertBoardIntegrity(op.data);const m=mergeBoards(op.base,op.data,current);assert.equal(m.conflicts.length,0);assertBoardIntegrity(m.data);assert.equal(m.data.notes[0].tasks[0].text,'local edit');assert.equal(m.data.notes.find(n=>n.id==='a').tasks.length,1);
});
test('physical cloud removal cannot discard remotely edited children after choosing remote',()=>{
 const b=base(),l=edit(b,v=>v.notes.shift()),r=edit(b,v=>v.notes[0].tasks[0].text='keep');const m=mergeBoards(b,l,r);assert.ok(m.conflicts.length);
 const choices=Object.fromEntries(m.conflicts.map(c=>[c.key,'remote']));const result=mergeBoards(b,l,r,choices);assert.equal(result.conflicts.length,0);assert.equal(result.data.notes.find(n=>n.id==='a').tasks[0].text,'keep');
});
