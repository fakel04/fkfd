import test from 'node:test';
import assert from 'node:assert/strict';
import {fitCount} from '../app/card-fit.ts';

const rows=(n,lines,caption=false)=>Array.from({length:n},()=>({lines,caption}));
const heading={heading:true};

test('a card shows 6 one-line tasks and 4 three-line tasks with a home cloud',()=>{
 assert.equal(fitCount(rows(10,1)),6);
 assert.equal(fitCount(rows(10,3,true)),4);
});

test('in-between tasks land in between',()=>{
 assert.equal(fitCount(rows(10,2)),5);
 assert.equal(fitCount(rows(10,1,true)),5);
 assert.equal(fitCount(rows(10,3)),4);
 assert.equal(fitCount(rows(10,2,true)),4);
 assert.equal(fitCount([...rows(2,3,true),...rows(10,1)]),5);
});

test('a short list is shown whole, and at least one task always shows',()=>{
 assert.equal(fitCount(rows(3,3,true)),3);
 assert.equal(fitCount([]),0);
 assert.equal(fitCount([{lines:30,caption:true}]),1);
});

test('«Сегодня» headings take room and never end the card',()=>{
 // (free) heading + 2 tasks, heading + 2 tasks = 9.8; the next heading fits but its task does not, so it is left out.
 const agenda=[heading,...rows(2,1,true),heading,...rows(2,1,true),heading,...rows(1,1,true)];
 assert.equal(fitCount(agenda),6);
 assert.equal(fitCount([heading,...rows(1,1)]),2);
 // The first heading is free: «Сегодня» also shows 4 long tasks with a home cloud.
 assert.equal(fitCount([heading,...rows(6,3,true)]),5);
});
