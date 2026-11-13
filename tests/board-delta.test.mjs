import test from 'node:test';
import assert from 'node:assert/strict';
import {difference,applyDifference} from '../app/board-delta.ts';
import {encodeSyncBody,decodeSyncBody} from '../app/sync-wire.ts';
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
const board=()=>({categories:[],notes:Array.from({length:9},(_,n)=>({id:'cloud'+n,title:'Облако '+n,text:'',color:'white',category:'',pinned:false,archived:false,deleted:false,created:'2026',tasks:Array.from({length:90},(_,t)=>({id:`task${n}-${t}`,text:`Подготовить образцы ${n}-${t}`,done:false,todoist:{id:`import${n}-${t}`,projectId:'project'+n,description:`Требования к образцам ${n}-${t}: проверить качество упаковки, уточнить размеры, подготовить расчёт и согласовать сроки. `.repeat(5),labels:['жду'],priority:'P3',recurring:false}}))}))});

test('810-task board: a checkbox uploads a field delta, never the full board',async t=>{
 const base=board(),data=structuredClone(base);data.notes[4].tasks[22].done=true;
 const operation={id:crypto.randomUUID(),base,data};
 const compact={operation:{id:operation.id,revision:5,delta:difference(base,data)},userId:'u',boardId:'b',compactResponse:true};
 const original=bytes({operation,userId:'u',boardId:'b'}),small=bytes(compact);
 assert.deepEqual(applyDifference(base,compact.operation.delta),data);
 assert.ok(small<500);assert.ok(original/small>1000);
 const encoded=await encodeSyncBody({operation,userId:'u',boardId:'b',compactResponse:true});
 assert.equal(encoded.headers['Content-Type'],'application/vnd.oblaka.sync+gzip');
 const roundtrip=await decodeSyncBody(new Request('https://example.test/sync',{method:'POST',...encoded}));
 assert.deepEqual(roundtrip.operation,operation);
 assert.ok(encoded.body.byteLength<original/10);
 t.diagnostic(JSON.stringify({tasks:810,originalBytes:original,deltaBytes:small,compressedFallbackBytes:encoded.body.byteLength}));
});
test('wire roundtrip preserves insertions, empty tasks, deletion, movement, reordering and explicit null',()=>{
 const base={notes:[{id:'a',tasks:[{id:'x',text:'',done:false,description:'old',dueDate:'2026-11-13'},{id:'y',text:'second',done:true}]},{id:'b',tasks:[]}],categories:['a'],labels:['idea']};
 const next={notes:[{id:'b',tasks:[{id:'x',text:'',done:false,dueDate:null}]},{id:'a',tasks:[{id:'new',text:'',done:false}]}],categories:[],labels:['wait']};
 const delta=JSON.parse(JSON.stringify(difference(base,next)));
 assert.deepEqual(applyDifference(base,delta),next);assert.equal(base.notes[0].tasks.length,2);
 const undef={a:undefined,b:2};assert.deepEqual(applyDifference({a:1,b:2},JSON.parse(JSON.stringify(difference({a:1,b:2},undef)))),{b:2});
});
test('malformed deltas cannot mutate prototypes, create sparse huge arrays or recurse without a bound',()=>{
 for(const delta of [JSON.parse('["object",{"__proto__":["set",{"polluted":true}]},[]]'),['array',50001,{}],['array',2,{}],['array',1,{'-1':['set',1]}],['object',{},['__proto__']]])assert.throws(()=>applyDifference(delta[0]==='array'?[]:{},delta));
 assert.equal({}.polluted,undefined);
 let deep=['set',1];for(let i=0;i<40;i++)deep=['object',{a:deep},[]];
 let nested={};for(let i=0;i<40;i++)nested={a:nested};assert.throws(()=>applyDifference(nested,deep));
});
test('decompression limits decoded data, including highly compressible oversized bodies',async()=>{
 const encoded=await encodeSyncBody({text:'x'.repeat(8000001)});
 await assert.rejects(decodeSyncBody(new Request('https://example.test/sync',{method:'POST',...encoded})),/too large/);
});
