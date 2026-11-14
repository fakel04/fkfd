import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resizeTaskInput,observeTaskInputWidth} from '../app/task-input-resize.ts';

function fixture(){
 const frames=new Map();let id=0,observer;
 globalThis.getComputedStyle=()=>({boxSizing:'border-box',paddingTop:'6px',paddingBottom:'6px',borderTopWidth:'0px',borderBottomWidth:'0px'});
 globalThis.requestAnimationFrame=fn=>{frames.set(++id,fn);return id};globalThis.cancelAnimationFrame=id=>frames.delete(id);
 globalThis.ResizeObserver=class{constructor(callback){this.callback=callback;observer=this}observe(){}disconnect(){this.disconnected=true}};
 const input={clientWidth:300,style:{height:'84px'},scrollHeight:36};
 return {input,frames,notify:()=>observer.callback(),observer:()=>observer,flush(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn())}};
}

test('repeated sizing shrinks multiline text and respects padding and borders without accumulating height',()=>{
 const {input}=fixture();resizeTaskInput(input);assert.equal(input.style.height,'36px');
 for(let i=0;i<20;i++)resizeTaskInput(input);assert.equal(input.style.height,'36px');
 input.scrollHeight=84;resizeTaskInput(input);assert.equal(input.style.height,'84px');input.scrollHeight=36;resizeTaskInput(input);assert.equal(input.style.height,'36px');
 globalThis.getComputedStyle=()=>({boxSizing:'border-box',borderTopWidth:'1px',borderBottomWidth:'1px'});resizeTaskInput(input);assert.equal(input.style.height,'38px');
 globalThis.getComputedStyle=()=>({boxSizing:'content-box',paddingTop:'6px',paddingBottom:'6px'});resizeTaskInput(input);assert.equal(input.style.height,'24px');
});
test('hiding and restoring a drag source preserves height and resizes outside ResizeObserver callbacks',()=>{
 const f=fixture();let calls=0;const cleanup=observeTaskInputWidth(f.input,()=>{calls++;resizeTaskInput(f.input)});
 f.input.clientWidth=0;f.notify();resizeTaskInput(f.input);assert.equal(f.input.style.height,'84px');assert.equal(f.frames.size,0);
 f.input.clientWidth=300;f.notify();assert.equal(calls,0);assert.equal(f.frames.size,1);f.flush();assert.equal(calls,1);assert.equal(f.input.style.height,'36px');
 f.notify();assert.equal(f.frames.size,0,'height-only observer delivery must not schedule another measurement');
 for(let i=0;i<12;i++){f.input.clientWidth=0;f.notify();f.input.clientWidth=300;f.notify();f.flush()}
 assert.equal(f.input.style.height,'36px');cleanup();assert.equal(f.observer().disconnected,true);
});
test('width updates coalesce; hiding or unmounting cancels a pending measurement',()=>{
 const f=fixture();let calls=0;const cleanup=observeTaskInputWidth(f.input,()=>calls++);
 f.input.clientWidth=240;f.notify();f.input.clientWidth=220;f.notify();assert.equal(f.frames.size,1);
 f.input.clientWidth=0;f.notify();f.flush();assert.equal(calls,0);
 f.input.clientWidth=220;f.notify();cleanup();f.flush();assert.equal(calls,0);assert.equal(f.frames.size,0);
});
