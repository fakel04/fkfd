// Updating the shell is independent of syncing the board. Only apply a complete
// bundle while idle; durable queued operations survive in account-scoped storage.
export function watchPreparedUpdate(version:string,canApply:()=>boolean){
 if(!/^[a-f0-9]{16}$/.test(version))return ()=>{};
 const key='oblaka-applied-interface';
 let idleSince=Date.now(),applied=false;
 const activity=()=>{idleSince=Date.now()};
 const check=()=>{
  if(applied||Date.now()-idleSince<3000||document.visibilityState!=='visible'||!canApply())return;
  if(document.querySelector('[role="dialog"]')||document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'))return;
  // Inline new-task fields can contain unsaved text even after losing focus.
  if([...document.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input:not([type="checkbox"]):not([type="radio"]),textarea')].some(el=>el.value))return;
  try{
   if(sessionStorage.getItem(key)===version)return;
   sessionStorage.setItem(key,version);
  }catch{return;} // Without a loop guard, leave the update for the next opening.
  applied=true;
  location.replace('/'); // cache-first root, even if the connection just dropped
 };
 const events=['pointerdown','pointermove','keydown','input','scroll','focusin','visibilitychange'] as const;
 for(const event of events)document.addEventListener(event,activity,{capture:true,passive:true});
 const timer=setInterval(check,1000);
 return()=>{clearInterval(timer);for(const event of events)document.removeEventListener(event,activity,true)};
}
