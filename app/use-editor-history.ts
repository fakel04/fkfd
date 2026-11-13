'use client';
import {useCallback,useReducer} from 'react';
import type {Note} from './board-model';
import {editorHistoryReducer,emptyHistory} from './editor-history';
export function useEditorHistory(){
 const [state,dispatch]=useReducer(editorHistoryReducer,undefined,()=>emptyHistory());
 const set=useCallback((value:Note|null|((current:Note|null)=>Note|null),group?:string)=>dispatch({type:'edit',value,group,at:Date.now()}),[]);
 const reset=useCallback((value:Note|null)=>dispatch({type:'reset',value}),[]);
 return {value:state.value,set,reset,canUndo:state.past.length>0,canRedo:state.future.length>0,
  undo:()=>dispatch({type:'undo'}),redo:()=>dispatch({type:'redo'}),breakGroup:()=>dispatch({type:'break'})};
}
