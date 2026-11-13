import test from 'node:test';
import assert from 'node:assert/strict';
import {watchPreparedUpdate} from '../app/app-update.ts';

function screen(t){
 t.mock.timers.enable({apis:['Date','setInterval'],now:1000});
 const document=Object.assign(new EventTarget(),{
  visibilityState:'visible',dialog:false,typing:false,fields:[],
  querySelector(){return this.dialog?{}:null},querySelectorAll(){return this.fields},
 });
 document.activeElement={matches:()=>document.typing};
 const store=new Map(),reloads=[];
 const replacements={document,sessionStorage:{getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)},location:{replace:path=>reloads.push(path)}};
 const old=Object.fromEntries(Object.keys(replacements).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(replacements))Object.defineProperty(globalThis,key,{value,configurable:true});
 t.after(()=>{for(const key of Object.keys(replacements)){if(old[key])Object.defineProperty(globalThis,key,old[key]);else delete globalThis[key]}});
 return {document,store,reloads,tick:ms=>t.mock.timers.tick(ms)};
}
const version='0123456789abcdef';
test('prepared interface waits for drafts/local writes to be safe and applies once during idle',t=>{
 const s=screen(t);let safe=false;const stop=watchPreparedUpdate(version,()=>safe);
 s.tick(5000);assert.deepEqual(s.reloads,[]);
 safe=true;s.tick(1000);assert.deepEqual(s.reloads,['/']);
 s.tick(10000);assert.equal(s.reloads.length,1);stop();
 // Reopening a stale document cannot trigger an endless reload cycle.
 const stopAgain=watchPreparedUpdate(version,()=>true);s.tick(5000);assert.equal(s.reloads.length,1);stopAgain();
});
test('open dialogs, focused fields, blurred unsaved inputs and hidden windows block activation',t=>{
 const s=screen(t);const stop=watchPreparedUpdate(version,()=>true);
 s.document.dialog=true;s.tick(5000);assert.equal(s.reloads.length,0);
 s.document.dialog=false;s.document.typing=true;s.tick(5000);assert.equal(s.reloads.length,0);
 s.document.typing=false;s.document.fields=[{value:'Несохранённая задача'}];s.tick(5000);assert.equal(s.reloads.length,0);
 s.document.fields=[];s.document.visibilityState='hidden';s.tick(5000);assert.equal(s.reloads.length,0);
 s.document.visibilityState='visible';s.document.dispatchEvent(new Event('visibilitychange'));s.tick(2000);assert.equal(s.reloads.length,0);
 s.tick(1000);assert.deepEqual(s.reloads,['/']);stop();
});
test('touching, typing or scrolling postpones replacement and cleanup stops it',t=>{
 const s=screen(t);const stop=watchPreparedUpdate(version,()=>true);
 for(const kind of ['pointerdown','keydown','input','scroll']){s.tick(2000);s.document.dispatchEvent(new Event(kind));assert.equal(s.reloads.length,0)}
 s.tick(2000);assert.equal(s.reloads.length,0);stop();s.tick(5000);assert.equal(s.reloads.length,0);
});
test('storage failure or an untrusted version cannot cause an automatic reload',t=>{
 const s=screen(t);sessionStorage.setItem=()=>{throw Error('unavailable')};
 const stop=watchPreparedUpdate(version,()=>true);s.tick(5000);assert.equal(s.reloads.length,0);stop();
 const invalid=watchPreparedUpdate('new-version',()=>true);s.tick(5000);assert.equal(s.reloads.length,0);invalid();
});
