import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAiLink,safeAiLink} from '../app/task-ai-links.ts';
import {boardSchema,moveToFocus,returnFromFocus} from '../app/board-model.ts';
import {mergeBoards} from '../app/board-merge.ts';
import {difference,applyDifference} from '../app/board-delta.ts';

const fixture=()=>({categories:[],notes:[{id:'cloud',title:'Работа',text:'',color:'white',category:'',pinned:false,archived:false,deleted:false,created:'2026',tasks:[{id:'task',text:'Обсудить план',done:false},{id:'other',text:'Другое дело',done:false}]}]});
const task=board=>board.notes.flatMap(note=>note.tasks).find(task=>task.id==='task');

test('accepts service links, trims pasted URLs, and rejects unsafe or wrong service URLs',()=>{
 assert.equal(normalizeAiLink('gpt',' https://chatgpt.com/c/abc '),'https://chatgpt.com/c/abc');
 assert.equal(normalizeAiLink('gpt','https://chat.openai.com/c/old'),'https://chat.openai.com/c/old');
 assert.equal(normalizeAiLink('claude','https://claude.ai/chat/abc'),'https://claude.ai/chat/abc');
 assert.equal(normalizeAiLink('gpt','  '),null);
 for(const url of ['javascript:alert(1)','http://chatgpt.com/c/abc','https://chatgpt.com.evil.test/c/abc','https://chatgpt.com@evil.test/','https://user:pass@chatgpt.com/','https://claude.ai/chat/abc','https://chatgpt.com:444/c/abc']){
  assert.throws(()=>normalizeAiLink('gpt',url));assert.equal(safeAiLink('gpt',url),null);
 }
 assert.throws(()=>normalizeAiLink('claude','https://chatgpt.com/c/abc'));
 assert.throws(()=>normalizeAiLink('gpt','https://chatgpt.com/'+ 'a'.repeat(2048)));
});

test('links survive validation, task transfers and wire roundtrip; removing one leaves the other intact',()=>{
 const board=fixture();task(board).gptUrl='https://chatgpt.com/c/one';task(board).claudeUrl='https://claude.ai/chat/two';
 const saved=boardSchema.parse(JSON.parse(JSON.stringify(board)));
 assert.deepEqual(saved,board);
 const moved=returnFromFocus(moveToFocus(saved,'cloud','task'),'task');
 assert.equal(task(moved).gptUrl,task(board).gptUrl);assert.equal(task(moved).claudeUrl,task(board).claudeUrl);
 const removed=structuredClone(saved);task(removed).gptUrl=null;
 assert.deepEqual(boardSchema.parse(applyDifference(saved,difference(saved,removed))),removed);
 assert.equal(task(removed).claudeUrl,'https://claude.ai/chat/two');
 assert.deepEqual(removed.notes[0].tasks[1],board.notes[0].tasks[1]);
 assert.equal(boardSchema.safeParse({...board,notes:[{...board.notes[0],tasks:[{...task(board),gptUrl:'javascript:alert(1)'}]}]}).success,false);
});

test('different service edits merge independently and same-service conflicts have readable names',()=>{
 const base=fixture(),local=structuredClone(base),remote=structuredClone(base);
 task(local).gptUrl='https://chatgpt.com/c/local';task(remote).claudeUrl='https://claude.ai/chat/remote';
 const merged=mergeBoards(base,local,remote);
 assert.equal(merged.conflicts.length,0);
 assert.equal(task(merged.data).gptUrl,task(local).gptUrl);assert.equal(task(merged.data).claudeUrl,task(remote).claudeUrl);
 task(remote).gptUrl='https://chatgpt.com/c/remote';
 const conflict=mergeBoards(base,local,remote);
 assert.equal(conflict.conflicts.length,1);assert.equal(conflict.conflicts[0].field,'Ссылка на GPT');
});

test('offline removal and an edit to the other service merge without resurrecting the removed link',()=>{
 const base=fixture();task(base).gptUrl='https://chatgpt.com/c/old';task(base).claudeUrl='https://claude.ai/chat/old';
 const local=structuredClone(base),remote=structuredClone(base);
 task(local).gptUrl=null;task(remote).claudeUrl='https://claude.ai/chat/new';
 const merged=mergeBoards(base,local,remote);
 assert.equal(merged.conflicts.length,0);assert.equal(task(merged.data).gptUrl,null);
 assert.equal(task(merged.data).claudeUrl,'https://claude.ai/chat/new');
});
