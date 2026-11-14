/**
 * How many tasks a board card shows. Every card has the same height budget; a task costs
 * more the taller it is, so short tasks show more of them and long ones fewer:
 *  - one-line tasks without a caption: 6 per card;
 *  - three-line tasks with a caption (home cloud, in «Задачи» and «Сегодня»): 4 per card;
 *  - anything in between lands in between (two-line, or one-line with a caption: 5).
 * A date heading in «Сегодня» costs half a one-line task; the first one is free. Card labels are clamped to 3 lines.
 */
export const FIT_BUDGET=12;
export const FIT_ROW=2,FIT_EXTRA_LINE=.4,FIT_CAPTION=.2,FIT_HEADING=1;

export type FitEntry={heading:true}|{heading?:false;lines:number;caption:boolean};

export const fitCost=(entry:FitEntry)=>entry.heading?FIT_HEADING:FIT_ROW+FIT_EXTRA_LINE*(Math.min(3,Math.max(1,entry.lines))-1)+(entry.caption?FIT_CAPTION:0);

/** Number of leading entries to show. Never ends on a heading, and always shows at least one task. */
export function fitCount(entries:FitEntry[],budget=FIT_BUDGET):number{
 let used=0,shown=0,firstTask=entries.findIndex(entry=>!entry.heading);
 for(let i=0;i<entries.length;i++){
  // The first date heading of «Сегодня» takes the place other cards give to a caption-free top.
  used+=i===0&&entries[i].heading?0:fitCost(entries[i]);
  if(used>budget+1e-9&&i>firstTask)break;
  if(!entries[i].heading)shown=i+1;
 }
 return shown;
}
