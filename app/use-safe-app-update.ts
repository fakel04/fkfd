'use client';
import {useEffect,useRef} from 'react';
import {watchPreparedUpdate} from './app-update';
export function useSafeAppUpdate(version:string|null,canApply:()=>boolean){
 const allowed=useRef(canApply);allowed.current=canApply;
 useEffect(()=>{if(version)return watchPreparedUpdate(version,()=>allowed.current())},[version]);
}
