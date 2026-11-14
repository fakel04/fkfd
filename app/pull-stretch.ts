/**
 * Decorative pull-down stretch for a full-screen panel (an open cloud or «Сегодня» on a phone).
 * The panel itself never rubber-bands (that revealed the board behind it); instead, when it is
 * scrolled to the top and the finger pulls down, its content follows with resistance and
 * springs back on release. Nothing else happens.
 */
const MAX=110;
/** Resistance: follows the finger at first, then slows down towards MAX. */
export const stretch=(dy:number)=>dy<=0?0:MAX*(1-Math.exp(-dy/(MAX*2.2)));

export function attachPullStretch(panel:HTMLElement,content:()=>HTMLElement|null){
 let startX=0,startY=0,active=false,decided=false,target:HTMLElement|null=null;
 const reset=()=>{
  if(!target)return;const el=target;target=null;
  el.style.transition='transform 380ms cubic-bezier(.2,.9,.25,1.15)';el.style.transform='';
  el.addEventListener('transitionend',()=>{el.style.transition=''},{once:true});
 };
 const start=(e:TouchEvent)=>{
  active=false;decided=false;
  if(e.touches.length!==1||panel.scrollTop>0)return;
  if((e.target as HTMLElement).closest('.drag-handle,.editor-task-grip,input[type=range]'))return;
  startX=e.touches[0].clientX;startY=e.touches[0].clientY;active=true;
 };
 const move=(e:TouchEvent)=>{
  if(!active)return;
  const dx=e.touches[0].clientX-startX,dy=e.touches[0].clientY-startY;
  if(!decided){
   if(Math.abs(dx)<6&&Math.abs(dy)<6)return;
   decided=true;
   // Only a vertical pull down from the very top; swipes and normal scrolling are left alone.
   if(dy<=0||Math.abs(dx)>Math.abs(dy)||panel.scrollTop>0){active=false;return}
   target=content();if(!target){active=false;return}
   target.style.transition='none';
  }
  if(!target)return;
  e.preventDefault();
  target.style.transform=`translateY(${stretch(dy).toFixed(1)}px)`;
 };
 const end=()=>{active=false;reset()};
 panel.addEventListener('touchstart',start,{passive:true});
 panel.addEventListener('touchmove',move,{passive:false});
 panel.addEventListener('touchend',end);panel.addEventListener('touchcancel',end);
 return()=>{
  panel.removeEventListener('touchstart',start);panel.removeEventListener('touchmove',move);
  panel.removeEventListener('touchend',end);panel.removeEventListener('touchcancel',end);
  if(target){target.style.transform='';target.style.transition=''}
 };
}
