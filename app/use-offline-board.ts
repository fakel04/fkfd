'use client';
import {useEffect,useState} from 'react';
import {type Board} from './board-model';
import {BrowserStorage} from './offline-storage';
import {OfflineController} from './offline-controller';
import {readSnapshot,sendSnapshot} from './offline-transport';
export function useOfflineBoard(initial:()=>Board){
 const [controller]=useState(()=>new OfflineController(new BrowserStorage(),{
  compact:true,read:readSnapshot,send:sendSnapshot,
 },initial));
 const [state,setState]=useState(controller.state);
 const [offlineReady,setOfflineReady]=useState(false);
 const [updateVersion,setUpdateVersion]=useState<string|null>(null);
 useEffect(()=>{const unsubscribe=controller.subscribe(()=>setState(controller.state));void controller.start();
  const sync=()=>{if(document.visibilityState==='visible')void controller.sync()};
  const reconnect=()=>{void controller.retry()};
  const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('oblaka-sync'):null;
  let lastRevision='';const broadcast=controller.subscribe(()=>{const value=JSON.stringify([controller.state.pending,controller.state.status]);if(value!==lastRevision){lastRevision=value;channel?.postMessage('changed')}});
  if(channel)channel.onmessage=()=>{void controller.refreshLocal().catch(()=>{})};
  window.addEventListener('online',reconnect);window.addEventListener('focus',sync);document.addEventListener('visibilitychange',sync);
  const interval=setInterval(sync,30000);
  const before=(event:BeforeUnloadEvent)=>{if(controller.state.storageFailed||controller.state.localSaving){event.preventDefault();event.returnValue=''}};
  window.addEventListener('beforeunload',before);
  return()=>{unsubscribe();broadcast();controller.stop();channel?.close();clearInterval(interval);window.removeEventListener('online',reconnect);window.removeEventListener('focus',sync);document.removeEventListener('visibilitychange',sync);window.removeEventListener('beforeunload',before)};
 },[controller]);
 useEffect(()=>{
  if(!state.ready||!('serviceWorker' in navigator))return;
  let cancelled=false,busy=false,lastCheck=0;
  const check=()=>{
   if(cancelled||busy||document.visibilityState!=='visible'||Date.now()-lastCheck<60000)return;
   busy=true;lastCheck=Date.now();
   void (async()=>{
    const registration=await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
    await registration.update().catch(()=>{});
    const ready=await navigator.serviceWorker.ready;
    const worker=registration.active||ready.active;if(!worker||cancelled)return;
    const assets=Array.from(document.querySelectorAll<HTMLScriptElement|HTMLLinkElement>('script[src],link[rel="stylesheet"][href]'))
     .map(el=>new URL(el instanceof HTMLScriptElement?el.src:el.href,location.href))
     .filter(url=>url.origin===location.origin).map(url=>url.pathname);
    await new Promise<void>(resolve=>{
     const channel=new MessageChannel();
     const timeout=setTimeout(()=>{channel.port1.close();resolve()},35000);
     channel.port1.onmessage=event=>{
      if(!cancelled){setOfflineReady(!!event.data?.ready);if(event.data?.updated&&/^[a-f0-9]{16}$/.test(event.data.version))setUpdateVersion(event.data.version)}
      clearTimeout(timeout);channel.port1.close();resolve();
     };
     worker.postMessage({type:'PREPARE_OFFLINE',assets},[channel.port2]);
    });
    if(navigator.storage?.persist)void navigator.storage.persist().catch(()=>{});
   })().catch(()=>{}).finally(()=>{busy=false});
  };
  const timer=setTimeout(check,1500),interval=setInterval(check,300000);
  window.addEventListener('online',check);window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
  return()=>{cancelled=true;clearTimeout(timer);clearInterval(interval);window.removeEventListener('online',check);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check)};
 },[state.ready]);
 return {controller,...state,offlineReady,updateVersion};
}
