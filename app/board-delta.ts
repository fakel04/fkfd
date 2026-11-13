import {equal} from './board-merge.ts';

// A small, versioned wire format. Array indices are applied to a copy, never spliced;
// this preserves empty tasks, ordering, optional fields and explicit nulls exactly.
export type Delta=['set',unknown]|['object',Record<string,Delta>,string[]]|['array',number,Record<string,Delta>];
export type CompactOperation={id:string;revision:number;delta:Delta};
export function difference(before:unknown,after:unknown):Delta{
 if(Array.isArray(before)&&Array.isArray(after)){
  const changed:Record<string,Delta>={};
  after.forEach((value,index)=>{if(!equal(before[index],value))changed[index]=difference(before[index],value)});
  return ['array',after.length,changed];
 }
 if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after)){
  const b=before as Record<string,unknown>,a=after as Record<string,unknown>,changed:Record<string,Delta>={};
  for(const key of Object.keys(a))if(a[key]!==undefined&&!equal(b[key],a[key]))Object.defineProperty(changed,key,{value:difference(b[key],a[key]),enumerable:true});
  return ['object',changed,Object.keys(b).filter(key=>!(key in a)||a[key]===undefined)];
 }
 return ['set',after];
}
export function applyDifference(before:unknown,delta:unknown):unknown{
 let nodes=0;
 function apply(value:unknown,change:unknown,depth:number):unknown{
  if(++nodes>100000||depth>32||!Array.isArray(change))throw new Error('Invalid delta');
  if(change[0]==='set'&&change.length===2)return change[1];
  const [kind,arg,extra]=change;
  if(kind==='array'){
   if(!Array.isArray(value)||!Number.isInteger(arg)||arg<0||arg>50000||!extra||typeof extra!=='object'||Array.isArray(extra))throw new Error('Invalid array delta');
   const result=value.slice(0,arg);result.length=arg;
   for(const [key,item] of Object.entries(extra)){
    if(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=arg)throw new Error('Invalid index');
    result[Number(key)]=apply(value[Number(key)],item,depth+1);
   }
   for(let i=0;i<arg;i++)if(!(i in result))throw new Error('Incomplete array');
   return result;
  }
  if(kind==='object'){
   if(!value||typeof value!=='object'||Array.isArray(value)||!arg||typeof arg!=='object'||Array.isArray(arg)||!Array.isArray(extra))throw new Error('Invalid object delta');
   const source=value as Record<string,unknown>,result={...source};
   const safe=(key:unknown)=>{if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key))throw new Error('Invalid key');return key};
   for(const key of extra)delete result[safe(key)];
   for(const [key,item] of Object.entries(arg))result[safe(key)]=apply(Object.hasOwn(source,key)?source[key]:undefined,item,depth+1);
   return result;
  }
  throw new Error('Invalid delta');
 }
 return apply(before,delta,0);
}
