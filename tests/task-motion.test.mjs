import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as motion from '../app/task-motion.ts';
import {reorderTasks,taskDropIndex,taskSortPositions} from '../app/task-sort.ts';

const task=(id,pinned=false)=>({id,text:id,done:false,pinned});
test('reordering preserves empty tasks, metadata and pinned groups without mutating the source',()=>{
 const tasks=[task('pin',true),{...task('a'),text:'',labels:['жду']},task('b')];
 const original=structuredClone(tasks);
 assert.deepEqual(reorderTasks(tasks,'b',0).map(t=>t.id),['pin','b','a']);
 assert.deepEqual(reorderTasks(tasks,'pin',99).map(t=>t.id),['pin','a','b']);
 assert.equal(reorderTasks(tasks,'missing',0),tasks);
 assert.deepEqual(tasks,original);
 assert.equal(reorderTasks(tasks,'a',2)[2],tasks[1]);
});
test('hit testing and insertion work with short, empty and tall task rows',()=>{
 const rows=[{id:'a',top:100,height:36},{id:'b',top:145,height:130},{id:'c',top:284,height:36}];
 assert.equal(taskDropIndex(rows,'a',205),0);
 assert.equal(taskDropIndex(rows,'a',215),1);
 assert.equal(taskDropIndex(rows,'a',320),2);
 assert.equal(taskDropIndex(rows,'c',100),0);
 assert.deepEqual([...taskSortPositions(rows,'a',2,9)],[['b',100],['c',239],['a',284]]);
 rows[0].pinned=true;
 assert.equal(taskDropIndex(rows,'a',999),0);
 assert.equal(taskDropIndex(rows,'c',0),1);
});

// A small DOM fixture exercises the actual controllers, not a second animation
// implementation. Geometry and animation completion are controlled by each test.
class Element{
 constructor(tag='div'){
  this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.attributes={};this.dataset={};this.className='';this.value='';this.animations=[];
  this.style={visibility:'',transform:'',setProperty(name,value){this[name]=value}};
  this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' '),...names])].join(' ')},remove:(...names)=>{this.className=this.className.split(' ').filter(name=>!names.includes(name)).join(' ')}};
  this.rect={left:16,top:100,width:330,height:36};
 }
 matches(selector){return selector.split(',').some(part=>{
  part=part.trim();if(part==='*')return true;
  if(part.startsWith('.'))return part.slice(1).split('.').every(name=>this.className.split(' ').includes(name));
  if(part.startsWith('['))return this.getAttributeNames().includes(part.slice(1,-1));
  return this.tagName.toLowerCase()===part;
 })}
 closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null}
 querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)])}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 appendChild(child){child.remove();child.parentElement=this;this.children.push(child);return child}
 remove(){if(this.parentElement){const parent=this.parentElement;parent.children=parent.children.filter(child=>child!==this);this.parentElement=null}}
 get isConnected(){return this===globalThis.document?.body||!!this.parentElement?.isConnected}
 setAttribute(name,value){this.attributes[name]=value;if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value}
 removeAttribute(name){delete this.attributes[name];if(name.startsWith('data-'))delete this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]}
 getAttributeNames(){return Object.keys(this.attributes)}
 cloneNode(deep){const copy=new Element(this.tagName);copy.className=this.className;copy.rect={...this.getBoundingClientRect()};for(const [name,value] of Object.entries(this.attributes))copy.setAttribute(name,value);if(deep)this.children.forEach(child=>copy.appendChild(child.cloneNode(true)));return copy}
 getBoundingClientRect(){
  const rect={...(typeof this.rect==='function'?this.rect():this.rect)};
  for(const name of ['left','top','width','height'])if(this.style[name])rect[name]=parseFloat(this.style[name]);
  const transform=this.style.transform?.match(/translate(?:3d)?\(([-.\d]+)px,\s*([-.\d]+)px/);
  if(transform){rect.left+=Number(transform[1]);rect.top+=Number(transform[2])}
  return {...rect,right:rect.left+rect.width,bottom:rect.top+rect.height};
 }
 animate(keyframes,options){let resolve;const animation={keyframes,options,finished:new Promise(r=>resolve=r),finish:()=>resolve(),cancel(){this.cancelled=true;resolve()}};this.animations.push(animation);return animation}
}
function fixture({reduce=false}={}){
 const body=new Element('body');
 globalThis.document={body,createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),querySelectorAll:selector=>body.querySelectorAll(selector),querySelector:selector=>body.querySelector(selector)};
 globalThis.window={matchMedia:()=>({matches:reduce}),visualViewport:{offsetLeft:0,offsetTop:0,width:390,height:800}};
 globalThis.innerWidth=390;globalThis.innerHeight=800;globalThis.getComputedStyle=()=>({backgroundColor:'#e8def8'});
 const app=body.appendChild(new Element());app.className='app-shell keep-layout';
 const editor=app.appendChild(new Element());editor.className='editor';
 const root=editor.appendChild(new Element());root.className='editor-tasks';root.rect={left:16,top:100,width:330,height:220};
 let order=['a','b','c'];const heights={a:36,b:130,c:36};
 const rows={};
 for(const id of order){
  const wrapper=root.appendChild(new Element());wrapper.className='swipe-task';
  wrapper.rect=()=>({left:16,top:root.rect.top+order.slice(0,order.indexOf(id)).reduce((n,key)=>n+heights[key]+9,0),width:330,height:heights[id]});
  const content=wrapper.appendChild(new Element());content.className='swipe-content';
  const row=content.appendChild(new Element());row.className='editor-task';row.setAttribute('data-editor-task-id',id);
  const input=row.appendChild(new Element('textarea'));input.value='Текст '+id;input.setAttribute('id','field-'+id);input.setAttribute('autofocus','');
  const menu=content.appendChild(new Element('button'));menu.className='task-menu-trigger';
  const actions=wrapper.appendChild(new Element());actions.className='swipe-actions';
  rows[id]={row,wrapper,input};
 }
 return {body,app,editor,root,rows,reorder(next){order=next;for(const id of next)root.appendChild(rows[id].wrapper)}};
}
test('drag preview reserves real row height and never writes data until a valid drop',async()=>{
 const f=fixture();let commits=0;
 const lift=new motion.TaskLift(f.root,f.rows.a.row,25,118,()=>false);
 assert.equal(f.rows.a.wrapper.style.visibility,'hidden');
 assert.equal(lift.move(25,315),2);
 assert.equal(lift.slot.style.height,'36px');
 assert.equal(lift.slot.style.top,'284px');
 assert.equal(f.rows.b.wrapper.style.transform,'translate3d(0,-45px,0)');
 const cleanup=lift.finish(()=>{commits++;f.reorder(['b','c','a'])});
 assert.equal(commits,1,'save occurs immediately, without waiting for animation');
 assert.equal(f.rows.a.wrapper.style.visibility,'hidden');
 assert.equal(f.body.querySelectorAll('.task-drop-slot').length,0);
 lift.ghost.element.animations.at(-1).finish();await Promise.resolve();
 assert.equal(f.rows.a.wrapper.style.visibility,'');
 assert.equal(f.body.querySelectorAll('.task-motion-ghost').length,0);
 cleanup();assert.equal(commits,1);
});
test('scrolling adjusts insertion hit testing; cancelling restores visibility and order',async()=>{
 const f=fixture(),lift=new motion.TaskLift(f.root,f.rows.a.row,25,118,()=>false);
 f.root.rect.top-=80;
 assert.equal(lift.move(25,235),2);
 assert.equal(lift.slot.style.top,'204px');
 assert.equal(lift.move(500,235),null);
 const cleanup=lift.finish();lift.ghost.element.animations.at(-1).finish();await Promise.resolve();
 assert.deepEqual(f.root.children.map(w=>w.querySelector('[data-editor-task-id]').dataset.editorTaskId),['a','b','c']);
 for(const {wrapper} of Object.values(f.rows)){assert.equal(wrapper.style.transform,'');assert.equal(wrapper.style.visibility,'')}
 cleanup();
});
test('visual copies preserve live textarea values and cannot duplicate ids or capture input',()=>{
 const f=fixture(),ghost=motion.taskGhost(f.rows.a.row).element;
 assert.equal(ghost.inert,true);assert.equal(ghost.attributes['aria-hidden'],'true');
 assert.equal(ghost.querySelector('textarea').value,'Текст a');
 assert.equal(ghost.querySelectorAll('[id],[data-editor-task-id],[autofocus],.swipe-actions,.task-menu-trigger').length,0);
 ghost.remove();
});
test('reduced motion commits once and restores the row synchronously; unmount cancels a preview',()=>{
 const f=fixture({reduce:true});let commits=0;
 const lift=new motion.TaskLift(f.root,f.rows.a.row,25,118,()=>false);
 lift.finish(()=>{commits++;f.reorder(['b','a','c'])});
 assert.equal(commits,1);assert.equal(f.body.querySelectorAll('.task-motion-ghost').length,0);assert.equal(f.rows.a.wrapper.style.visibility,'');
 const next=new motion.TaskLift(f.root,f.rows.b.row,25,118,()=>false);next.move(25,300);next.dispose();
 assert.equal(f.body.querySelectorAll('.task-motion-ghost,.task-drop-slot').length,0);
 for(const {wrapper} of Object.values(f.rows))assert.equal(wrapper.style.visibility,'');
});
test('FLIP subtracts ancestor displacement so card and task do not move twice',()=>{
 const f=fixture();const card=f.app.appendChild(new Element());card.className='note';card.rect={left:10,top:100,width:160,height:200};
 const row=card.appendChild(new Element());row.className='swipe-task';row.rect={left:20,top:150,width:140,height:36};
 const before=motion.captureTaskLayout(f.app);card.rect.top+=40;row.rect.top+=60;
 const cleanup=motion.animateTaskLayout(before);
 assert.equal(card.animations[0].keyframes[0].transform,'translate(0px,-40px)');
 assert.equal(row.animations[0].keyframes[0].transform,'translate(0px,-20px)');cleanup();
 assert.equal(row.animations[0].cancelled,true);
});

// Run the actual transfer hook with only React lifecycle and timer scheduling
// substituted; this verifies immediate commits separately from visual completion.
function transferHarness(){
 const effects=[],timers=new Map();let seq=0;
 const code=ts.transpileModule(readFileSync(new URL('../app/use-task-transfer-motion.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 const context={exports:module.exports,require:name=>name==='react'?{useRef:value=>({current:value}),useEffect:fn=>effects.push(fn())}:name==='react-dom'?{flushSync:fn=>fn()}:motion,document,window,innerWidth,innerHeight,
  setTimeout:fn=>{timers.set(++seq,fn);return seq},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(code,context);
 return {transfer:module.exports.useTaskTransferMotion(),cleanup:()=>effects.forEach(fn=>fn()),timers};
}
test('transfer commits before flight ends and cleans up when the editor unmounts',()=>{
 const f=fixture(),h=transferHarness();let commits=0;
 h.transfer('source','a','focus','Задачи',true,()=>{commits++;f.rows.a.wrapper.remove()});
 assert.equal(commits,1);assert.equal(f.rows.a.wrapper.isConnected,false);
 const ghost=f.body.querySelector('.task-motion-ghost');
 assert.ok(ghost);assert.equal(ghost.animations[0].options.duration,620);
 const pill=f.body.querySelector('.task-transfer-destination');assert.equal(pill.querySelector('span').textContent,'В «Задачи»');
 h.cleanup();assert.equal(f.body.querySelectorAll('.task-motion-ghost,.task-transfer-destination').length,0);assert.equal(h.timers.size,0);
});
test('transfer falls back to an immediate commit when no source is visible or motion is reduced',()=>{
 for(const reduce of [false,true]){
  const f=fixture({reduce}),h=transferHarness();let commits=0;
  h.transfer('source',reduce?'a':'missing','focus','Задачи',true,()=>commits++);
  assert.equal(commits,1);assert.equal(f.body.querySelectorAll('.task-motion-ghost').length,0);h.cleanup();
 }
});
