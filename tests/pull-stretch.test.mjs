import test from 'node:test';
import assert from 'node:assert/strict';
import {stretch} from '../app/pull-stretch.ts';

test('pull-down stretch follows the finger with growing resistance and a hard cap',()=>{
 assert.equal(stretch(-20),0);assert.equal(stretch(0),0);
 assert.ok(stretch(20)>5&&stretch(20)<20);
 assert.ok(stretch(200)-stretch(100)<stretch(100)-stretch(0));
 assert.ok(stretch(5000)<=110);
});
