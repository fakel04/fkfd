import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boardSchema,moveToFocus,returnFromFocus,taskDescription} from '../app/board-model.ts';
import {taskParent,canChooseParent,parentChoices} from '../app/task-relations.ts';
import {readBoardTool} from '../app/mcp-tools.ts';

const note=(id,tasks,extra={})=>({id,title:id,text:'',tasks,category:'',color:'white',pinned:false,archived:false,deleted:false,created:'2026-11-13',...extra});
const meta=(id,extra={})=>({id,projectId:'p',description:'Старый текст',labels:['идея'],priority:'p4',recurring:false,...extra});
const fixture=()=>({categories:[],notes:[note('Работа',[
 {id:'root',text:'Выставка',done:false,todoist:meta('td-root')},
 {id:'child',text:'Образцы',done:false,todoist:meta('td-child',{parentId:'td-root',parentTitle:'Прежнее имя выставки'})},
 {id:'grandchild',text:'Расчёт',done:false,parent:{taskId:'child',title:'Образцы'}},
 ]),note('Личное',[{id:'local',text:'План',done:false}])]});
const get=(board,id)=>board.notes.flatMap(note=>note.tasks).find(task=>task.id===id);
test('imported parent resolves to current title and survives parent rename and move',()=>{
 let board=fixture();assert.deepEqual(taskParent(board,get(board,'child')),{taskId:'root',title:'Выставка'});
 get(board,'root').text='Новая выставка';board=moveToFocus(board,'Работа','root');
 assert.deepEqual(taskParent(board,get(board,'child')),{taskId:'root',title:'Новая выставка'});
});
test('description edits and clearing persist on imported and local tasks without changing neighbors',()=>{
 const board=fixture(),root=structuredClone(get(board,'root'));
 get(board,'child').description='Новый текст\nhttps://example.com';get(board,'local').description='Своя заметка';
 const saved=boardSchema.parse(JSON.parse(JSON.stringify(board)));
 assert.equal(taskDescription(get(saved,'child')),'Новый текст\nhttps://example.com');assert.equal(taskDescription(get(saved,'local')),'Своя заметка');assert.deepEqual(get(saved,'root'),root);
 get(saved,'child').description='';assert.equal(taskDescription(boardSchema.parse(saved).notes[0].tasks[1]),'');
});
test('parent selection blocks self, descendants and invalid or archived destinations',()=>{
 const board=fixture();assert.equal(canChooseParent(board,'root','root'),false);assert.equal(canChooseParent(board,'root','child'),false);assert.equal(canChooseParent(board,'root','grandchild'),false);
 assert.equal(canChooseParent(board,'child','local'),true);assert.equal(canChooseParent(board,'child','missing'),false);
 assert.deepEqual(parentChoices(board,'root').map(item=>item.taskId),['local']);
 board.notes[1].archived=true;assert.equal(canChooseParent(board,'child','local'),false);board.notes[1].archived=false;board.notes[1].deleted=true;assert.equal(canChooseParent(board,'child','local'),false);
});
test('explicit parent change and unlink override import across save, focus and return',()=>{
 let board=fixture();get(board,'child').parent={taskId:'local',title:'План'};get(board,'child').description='Пояснение';
 board=boardSchema.parse(JSON.parse(JSON.stringify(moveToFocus(board,'Работа','child'))));
 assert.equal(taskParent(board,get(board,'child')).taskId,'local');board=returnFromFocus(board,'child');assert.equal(taskDescription(get(board,'child')),'Пояснение');
 get(board,'child').parent=null;board=boardSchema.parse(JSON.parse(JSON.stringify(board)));assert.equal(taskParent(board,get(board,'child')),null);
 assert.ok(canChooseParent(board,'root','child'));
});
test('removed parent retains its saved title and can be unlinked',()=>{
 const board=fixture();get(board,'local').parent={taskId:'root',title:'Выставка'};board.notes[0].tasks=board.notes[0].tasks.filter(task=>task.id!=='root');
 assert.deepEqual(taskParent(board,get(board,'local')),{taskId:'root',title:'Выставка'});get(board,'local').parent=null;assert.equal(taskParent(board,get(board,'local')),null);
});
test('MCP uses edited description and parent, with no stale imported fields after clearing',()=>{
 const board=fixture();get(board,'child').description='Новый чертёж';get(board,'child').parent={taskId:'local',title:'План'};
 const output=readBoardTool('get_cloud',{cloud_id:'Работа'},board,1).tasks.items.find(task=>task.id==='child');
 assert.equal(output.description,'Новый чертёж');assert.equal(output.todoist.description,'Новый чертёж');assert.equal(output.parent.taskId,'local');assert.equal(output.todoist.parentTitle,'План');assert.equal(output.todoist.parentId,undefined);
 assert.equal(readBoardTool('search_tasks',{query:'Образцы чертёж План'},board,1).total,1);
 get(board,'child').description='';get(board,'child').parent=null;
 assert.equal(readBoardTool('search_tasks',{query:'Образцы Старый'},board,1).total,0);assert.equal(readBoardTool('search_tasks',{query:'Образцы Выставка'},board,1).total,0);
});
