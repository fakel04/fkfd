export const clampSwipe=(value:number,leftWidth:number,rightWidth:number)=>Math.max(-rightWidth,Math.min(leftWidth,value));
export const settleSwipe=(value:number,leftWidth:number,rightWidth:number)=>value>leftWidth*.28?leftWidth:value< -rightWidth*.28?-rightWidth:0;
