import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAgenda,agendaUrgentCount,dateLabel,agendaDays,moveAgendaTask} from '../app/today-agenda.ts';
import {boardSchema,taskDueDate} from '../app/board-model.ts';
import {dueParts} from '../app/task-due.ts';
import {mergeBoards} from '../app/board-merge.ts';
const note=(id,tasks,extra={})=>({id,title:id,text:'',color:'white',category:'',created:'x',pinned:false,archived:false,deleted:false,tasks,...extra});
const task=(id,dueDate,extra={})=>({id,text:id,done:false,dueDate,...extra});
const board={categories:[],notes:[
 note('__focus_tasks__',[task('f1','2026-11-14',{focused:true,origin:{noteId:'work',title:'Работа',color:'white',category:'',index:0}})],{kind:'focus'}),
 note('work',[task('late','2026-11-10'),task('t-timed',new Date(2026,10,14,9,30).toISOString()),task('t-all','2026-11-14'),task('tomorrow','2026-11-15'),task('later','2026-11-20'),task('nodate',null),task('done','2026-11-14',{done:true})]),
 note('old',[task('archived','2026-11-14')],{archived:true}),
 note('trash',[task('deleted','2026-11-14')],{deleted:true}),
 note('todoist',[{id:'imported',text:'imported',done:false,todoist:{id:'1',projectId:'p',description:'',labels:[],priority:'1',recurring:false,dueDate:'2026-11-15'}}]),
]};
test('tasks with a due date are grouped by date: overdue first, then today and later',()=>{
 const groups=buildAgenda(board,'2026-11-14');
 assert.deepEqual(groups.map(g=>[g.key,g.label,g.hint]),[['overdue','Просрочено',''],['2026-11-14','14.11 Сб','сегодня'],['2026-11-15','15.11 Вс','завтра'],['2026-11-20','20.11 Пт','']]);
 assert.deepEqual(groups[1].items.map(i=>i.task.id),['f1','t-all','t-timed']);
 assert.deepEqual(groups[2].items.map(i=>i.task.id),['tomorrow','imported']);
 // Tasks in «Задачи» show their source cloud.
 assert.equal(groups[1].items[0].source,'work'); // current title of the source cloud
 assert.equal(agendaUrgentCount(groups,'2026-11-14'),4);
});
test('done, undated, archived and deleted tasks are not shown; an empty board has no groups',()=>{
 const ids=buildAgenda(board,'2026-11-14').flatMap(g=>g.items.map(i=>i.task.id));
 for(const id of ['done','nodate','archived','deleted'])assert.equal(ids.includes(id),false);
 assert.deepEqual(buildAgenda({notes:[],categories:[]},'2026-11-14'),[]);
 assert.equal(dateLabel('2026-11-16'),'16.11 Пн');
});

const find=(data,id)=>data.notes.flatMap(note=>note.tasks).find(task=>task.id===id);
test('dragging across dates preserves time, cloud, task metadata and imported source values',()=>{
 const before=structuredClone(board);find(before,'t-timed').gptUrl='https://chatgpt.com/c/chat';
 const moved=moveAgendaTask(before,'2026-11-14','t-timed','2026-11-15','tomorrow');
 assert.deepEqual(dueParts(taskDueDate(find(moved,'t-timed'))),{date:'2026-11-15',time:'09:30'});
 assert.equal(moved.notes.find(note=>note.tasks.some(task=>task.id==='t-timed')).id,'work');
 assert.equal(find(moved,'t-timed').gptUrl,'https://chatgpt.com/c/chat');
 assert.equal(dueParts(taskDueDate(find(before,'t-timed'))).date,'2026-11-14');
 const imported=moveAgendaTask(before,'2026-11-14','imported','2026-11-20');
 assert.equal(find(imported,'imported').dueDate,'2026-11-20');assert.equal(find(imported,'imported').todoist.dueDate,'2026-11-15');
 const focused=moveAgendaTask(before,'2026-11-14','f1','2026-11-20');
 assert.equal(focused.notes[0].tasks[0].id,'f1');assert.deepEqual(find(focused,'f1').origin,find(before,'f1').origin);
 assert.deepEqual(boardSchema.parse(JSON.parse(JSON.stringify(moved))),moved);
});
test('manual ordering works across source clouds in the same day and survives rebuilding the agenda',()=>{
 const moved=moveAgendaTask(board,'2026-11-14','t-timed','2026-11-14','f1');
 assert.deepEqual(buildAgenda(moved,'2026-11-14').find(group=>group.key==='2026-11-14').items.map(item=>item.task.id),['t-timed','f1','t-all']);
 assert.equal(find(moved,'t-timed').dueDate,find(board,'t-timed').dueDate);
 const appended=moveAgendaTask(moved,'2026-11-14','t-timed','2026-11-14');
 assert.deepEqual(buildAgenda(appended,'2026-11-14').find(group=>group.key==='2026-11-14').items.map(item=>item.task.id),['f1','t-all','t-timed']);
 assert.equal(moveAgendaTask(board,'2026-11-14','f1','2026-11-14','t-all'),board);
});
test('every overdue divider is an exact date; empty today and tomorrow are available while dragging',()=>{
 const groups=buildAgenda(board,'2026-11-14'),days=agendaDays(groups,'2026-11-14',true);
 assert.equal(days[0].key,'2026-11-10');assert.equal(days[0].overdue,true);
 assert.deepEqual(agendaDays([],'2026-11-14',true).map(day=>day.key),['2026-11-14','2026-11-15']);
 assert.deepEqual(agendaDays([],'2026-11-14'),[]);
 const moved=moveAgendaTask(board,'2026-11-14','later','2026-11-18');
 assert.equal(buildAgenda(moved,'2026-11-14').find(group=>group.key==='2026-11-18').items[0].task.id,'later');
 for(const id of ['missing','done','archived','deleted','nodate'])assert.equal(moveAgendaTask(board,'2026-11-14',id,'2026-11-15'),board);
 assert.equal(moveAgendaTask(board,'2026-11-14','f1','2026-02-30'),board);
});
test('a drop merges with a simultaneous text edit without moving or duplicating tasks',()=>{
 const local=moveAgendaTask(board,'2026-11-14','f1','2026-11-15','tomorrow'),remote=structuredClone(board);
 find(remote,'f1').text='Новое название';
 const merged=mergeBoards(board,local,remote);
 assert.equal(merged.conflicts.length,0);assert.equal(find(merged.data,'f1').text,'Новое название');assert.equal(find(merged.data,'f1').dueDate,'2026-11-15');
 assert.equal(merged.data.notes.flatMap(note=>note.tasks).filter(task=>task.id==='f1').length,1);
});
