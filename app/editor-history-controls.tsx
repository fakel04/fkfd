'use client';
import {useEffect,useState} from 'react';
import {Undo2,Redo2} from 'lucide-react';

export function EditorHistoryControls({canUndo,canRedo,onUndo,onRedo}:{canUndo:boolean;canRedo:boolean;onUndo:()=>void;onRedo:()=>void}){
 const [keyboardTop,setKeyboardTop]=useState<number|null>(null);
 useEffect(()=>{
  const viewport=window.visualViewport;if(!viewport)return;
  const update=()=>{
   const typing=document.activeElement?.matches('.editor input,.editor textarea');
   const keyboard=window.innerWidth<=760&&typing&&window.innerHeight-viewport.height>120;
   setKeyboardTop(keyboard?viewport.offsetTop+viewport.height-48:null);
  };
  viewport.addEventListener('resize',update);viewport.addEventListener('scroll',update);
  document.addEventListener('focusin',update);document.addEventListener('focusout',update);update();
  return()=>{viewport.removeEventListener('resize',update);viewport.removeEventListener('scroll',update);document.removeEventListener('focusin',update);document.removeEventListener('focusout',update)};
 },[]);
 return <div className={'editor-history-controls'+(keyboardTop!==null?' above-keyboard':'')} role="group" aria-label="История изменений" style={keyboardTop!==null?{top:keyboardTop}:undefined}>
  <button type="button" className="icon-button" title="Отменить действие" aria-label="Отменить действие" disabled={!canUndo} onPointerDown={event=>event.preventDefault()} onClick={onUndo}><Undo2 size={23}/></button>
  <button type="button" className="icon-button" title="Повторить действие" aria-label="Повторить действие" disabled={!canRedo} onPointerDown={event=>event.preventDefault()} onClick={onRedo}><Redo2 size={23}/></button>
 </div>;
}
