import {normalizeEmail} from './access-model.ts';

/** Owner-verified login identities, configured only in the server environment. */
export function parseLoginAliases(value:string|undefined):ReadonlyMap<string,string>{
 const aliases=new Map<string,string>();
 if(!value)return aliases;
 let parsed:unknown;
 try{parsed=JSON.parse(value)}catch{throw new Error('Invalid login aliases configuration')}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Invalid login aliases configuration');
 const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
 for(const [login,target] of Object.entries(parsed)){
  if(typeof target!=='string'||!email.test(login)||!email.test(target))throw new Error('Invalid login alias');
  const key=normalizeEmail(login),member=normalizeEmail(target);
  if(key!==member)aliases.set(key,member);
 }
 return aliases;
}
