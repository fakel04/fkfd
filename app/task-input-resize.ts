/** Hidden drag sources have no usable width; keep their last measured height. */
export function resizeTaskInput(input:HTMLTextAreaElement){
 if(input.clientWidth<=0)return;
 const style=getComputedStyle(input);
 const px=(value:string)=>parseFloat(value)||0;
 const adjustment=style.boxSizing==='border-box'
  ?px(style.borderTopWidth)+px(style.borderBottomWidth)
  :-px(style.paddingTop)-px(style.paddingBottom);
 input.style.height='auto';
 input.style.height=Math.max(0,Math.ceil(input.scrollHeight+adjustment))+'px';
}

/** Width changes are observed now and measured next frame, outside observer delivery. */
export function observeTaskInputWidth(input:HTMLTextAreaElement,resize:()=>void){
 let width=input.clientWidth,frame:number|null=null,disposed=false;
 const observer=new ResizeObserver(()=>{
  const next=input.clientWidth;if(next===width)return;width=next;
  if(frame!==null)cancelAnimationFrame(frame);frame=null;
  if(next<=0)return;
  frame=requestAnimationFrame(()=>{frame=null;if(!disposed&&input.clientWidth>0)resize()});
 });
 observer.observe(input);
 return()=>{disposed=true;observer.disconnect();if(frame!==null)cancelAnimationFrame(frame)};
}
