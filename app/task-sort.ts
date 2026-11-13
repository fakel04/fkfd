import type {Task} from './board-model.ts';

export type SortBox={id:string;top:number;height:number;pinned?:boolean};

/** Drop index is in the remaining list. Keep pinned and ordinary tasks in their groups. */
export function taskDropIndex(rows:SortBox[],id:string,y:number){
 const source=rows.find(row=>row.id===id);if(!source)return -1;
 const rest=rows.filter(row=>row.id!==id);
 const found=rest.findIndex(row=>y<row.top+row.height/2);
 const index=found<0?rest.length:found;
 const pins=rest.filter(row=>row.pinned).length;
 return source.pinned?Math.min(index,pins):Math.max(index,pins);
}

export function reorderTasks(tasks:Task[],id:string,index:number){
 const source=tasks.find(task=>task.id===id);if(!source||index<0)return tasks;
 const rest=tasks.filter(task=>task.id!==id),pins=rest.filter(task=>task.pinned).length;
 const target=source.pinned?Math.min(index,pins):Math.max(index,pins);
 rest.splice(Math.max(0,Math.min(target,rest.length)),0,source);return rest;
}

/** Project variable-height rows into the new order without mutating the task data. */
export function taskSortPositions(rows:SortBox[],id:string,index:number,gap:number){
 const source=rows.find(row=>row.id===id);if(!source)return new Map<string,number>();
 const ordered=rows.filter(row=>row.id!==id);ordered.splice(index,0,source);
 let top=rows[0]?.top??0;
 return new Map(ordered.map(row=>{const result:[string,number]=[row.id,top];top+=row.height+gap;return result}));
}
