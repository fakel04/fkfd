import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boardLabels,boardSchema,hasLabel,moveToFocus,noteHasLabel,preserveLabelCatalog,returnFromFocus,taskLabels} from '../app/board-model.ts';
import {readBoardTool} from '../app/mcp-tools.ts';

const fixture=()=>({categories:['Картон','Косметика','Идеи'],notes:[{id:'cloud',title:'На сегодня',text:'',category:'Косметика',color:'white',pinned:false,archived:false,deleted:false,created:'2026-11-13',tasks:[{id:'task',text:'Задача',done:false,todoist:{id:'td-task',projectId:'p',description:'Описание',labels:['идея','жду'],priority:'p4',recurring:false}},{id:'local',text:'Местная задача',done:false}]}]});

test('tag catalog uses real labels, never category or cloud names',()=>{
 const board=fixture();board.notes[0].labels=['обсудить'];board.labels=['потом','ЖДУ'];
 const labels=boardLabels(board);
 assert.equal(labels.length,3);assert.ok(hasLabel(labels,'жду'));assert.ok(hasLabel(labels,'идея'));assert.ok(!hasLabel(labels,'обсудить'));assert.ok(hasLabel(labels,'потом'));
 for(const name of ['Картон','Косметика','Идеи','На сегодня'])assert.ok(!hasLabel(labels,name));
});
test('task tags persist; legacy cloud labels never become task assignments',()=>{
 const board=fixture();board.notes[0].labels=['обсудить','идея'];board.notes[0].tasks[1].labels=['жду'];board.labels=boardLabels(board);
 const saved=boardSchema.parse(JSON.parse(JSON.stringify(board)));
 assert.deepEqual(saved.notes[0].labels,['обсудить','идея']);assert.deepEqual(taskLabels(saved.notes[0].tasks[1]),['жду']);assert.deepEqual(taskLabels(saved.notes[0].tasks[0]),['идея','жду']);
 assert.equal(saved.notes[0].category,'Косметика');assert.ok(!noteHasLabel(saved.notes[0],'ОБСУДИТЬ'));assert.ok(noteHasLabel(saved.notes[0],'ЖДУ'));
});
test('explicit removal overrides imported tags and survives moving, returning and reload',()=>{
 const board=fixture();board.notes[0].tasks[0].labels=[];board.labels=['идея','жду'];
 let saved=boardSchema.parse(JSON.parse(JSON.stringify(moveToFocus(board,'cloud','task'))));
 const focus=saved.notes.find(n=>n.id==='__focus_tasks__');assert.deepEqual(taskLabels(focus.tasks[0]),[]);assert.equal(focus.tasks[0].origin.noteId,'cloud');
 saved=returnFromFocus(saved,'task');const task=saved.notes.find(n=>n.id==='cloud').tasks[0];assert.deepEqual(taskLabels(task),[]);assert.deepEqual(task.todoist.labels,['идея','жду']);assert.ok(hasLabel(boardLabels(saved),'жду'));
});
test('removing the last assignment keeps imported tags available for selection',()=>{
 const before=fixture(),next=structuredClone(before);next.notes[0].tasks[0].labels=[];
 const saved=boardSchema.parse(preserveLabelCatalog(next,before));
 assert.deepEqual(taskLabels(saved.notes[0].tasks[0]),[]);assert.deepEqual(boardLabels(saved),['жду','идея']);
 assert.deepEqual(before.notes[0].tasks[0].labels,undefined);
});
test('MCP reads effective task labels and ignores legacy cloud labels',()=>{
 const board=fixture();board.notes[0].labels=['обсудить'];board.notes[0].tasks[0].labels=['потом'];board.notes[0].tasks[1].labels=['жду'];
 const cloud=readBoardTool('get_cloud',{cloud_id:'cloud'},board,1);assert.equal(cloud.cloud.labels,undefined);assert.deepEqual(cloud.tasks.items[0].labels,['потом']);
 assert.deepEqual(cloud.tasks.items[0].todoist.labels,['потом']);
 assert.equal(readBoardTool('search_tasks',{query:'обсудить'},board,1).total,0);
 assert.equal(readBoardTool('search_tasks',{query:'идея'},board,1).total,0);
 assert.equal(readBoardTool('search_tasks',{query:'потом'},board,1).items[0].id,'task');
 assert.equal(readBoardTool('search_tasks',{query:'жду'},board,1).items[0].id,'local');
 assert.equal(readBoardTool('list_clouds',{query:'обсудить'},board,1).total,0);
});
