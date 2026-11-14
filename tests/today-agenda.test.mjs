import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAgenda,agendaUrgentCount,dateLabel} from '../app/today-agenda.ts';
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
