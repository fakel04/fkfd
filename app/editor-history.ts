import type {Note} from './board-model.ts';
import {equal} from './board-merge.ts';

export type EditorHistory={value:Note|null;past:Note[];future:Note[];group?:{key:string;start:number;last:number}};
type Edit=Note|null|((current:Note|null)=>Note|null);
export type HistoryAction={type:'reset';value:Note|null}|{type:'edit';value:Edit;group?:string;at:number}|{type:'undo'|'redo'|'break'};
export const emptyHistory=(value:Note|null=null):EditorHistory=>({value,past:[],future:[]});
const LIMIT=100;

// Notes and tasks are edited immutably. Sharing untouched objects between steps
// avoids cloning imported descriptions for every keystroke on a phone.
export function editorHistoryReducer(state:EditorHistory,action:HistoryAction):EditorHistory{
 if(action.type==='reset')return emptyHistory(action.value);
 if(action.type==='break')return state.group?{...state,group:undefined}:state;
 if(action.type==='undo'){
  if(!state.value||!state.past.length)return state;
  return {value:state.past.at(-1)!,past:state.past.slice(0,-1),future:[state.value,...state.future]};
 }
 if(action.type==='redo'){
  if(!state.value||!state.future.length)return state;
  return {value:state.future[0],past:[...state.past,state.value].slice(-LIMIT),future:state.future.slice(1)};
 }
 if(action.type!=='edit')return state;
 const next=typeof action.value==='function'?action.value(state.value):action.value;
 if(!next||!state.value||next.id!==state.value.id)return emptyHistory(next);
 if(equal(next,state.value))return state;
 const join=!!action.group&&action.group===state.group?.key&&!state.future.length&&action.at-state.group.last<800&&action.at-state.group.start<5000;
 return {value:next,past:join?state.past:[...state.past,state.value].slice(-LIMIT),future:[],
  group:action.group?{key:action.group,start:join?state.group!.start:action.at,last:action.at}:undefined};
}
