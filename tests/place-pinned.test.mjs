import test from 'node:test';
import assert from 'node:assert/strict';
import {placePinned} from '../app/board-model.ts';
import {noteEdit} from '../app/board-merge.ts';

const note=(id,pinned=false,extra={})=>({id,title:id,text:'',color:'white',category:'',created:'2026',pinned,archived:false,deleted:false,tasks:[],...extra});
const focus=()=>note('__focus_tasks__',true,{kind:'focus'});
const ids=notes=>notes.map(n=>n.id);

test('a newly pinned cloud goes right after «Задачи», above other pinned clouds',()=>{
 const notes=[focus(),note('P1',true),note('P2',true),note('A'),note('B',true)];
 assert.deepEqual(ids(placePinned(notes,'B')),['__focus_tasks__','B','P1','P2','A']);
 // Without a pinned «Задачи» it becomes the first pinned cloud.
 assert.deepEqual(ids(placePinned([note('A'),note('P1',true),note('B',true)],'B')),['A','B','P1']);
 // Unpinned clouds and «Задачи» itself are left in place.
 assert.deepEqual(ids(placePinned(notes,'A')),ids(notes));
});

test('pinning in the open cloud moves it on save',()=>{
 const board={categories:[],notes:[focus(),note('P1',true),note('A')]};
 const original=board.notes[2];
 assert.deepEqual(ids(noteEdit(board,original,{...original,pinned:true}).data.notes),['__focus_tasks__','A','P1']);
 // Other edits of an already pinned cloud keep its place.
 assert.deepEqual(ids(noteEdit(board,board.notes[1],{...board.notes[1],title:'x'}).data.notes),['__focus_tasks__','P1','A']);
});
