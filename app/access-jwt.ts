// Verifies the Cloudflare Access application token (Cf-Access-Jwt-Assertion).
// Access signs it with RS256 keys published at https://<team>/cdn-cgi/access/certs.
// Never trust identity headers without this check: a Worker URL that is reachable
// without Access would otherwise accept any forged email.

export type AccessClaims={sub:string;email:string};
/** The key server failed. This is an outage, not a sign-out. */
export class AccessKeysUnavailable extends Error{}
type Jwk=JsonWebKey&{kid?:string};
type KeyFetcher=(url:string)=>Promise<{keys:Jwk[]}>;

const decoder=new TextDecoder();
function base64url(value:string):Uint8Array<ArrayBuffer>{
 if(!/^[A-Za-z0-9_-]*$/.test(value))throw new Error('Invalid token encoding');
 const padded=value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4);
 const binary=atob(padded),bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return bytes;
}
const json=(part:string)=>JSON.parse(decoder.decode(base64url(part)));

/** Accepts "team.cloudflareaccess.com" or "https://team.cloudflareaccess.com/". */
export function teamOrigin(teamDomain:string){
 const host=teamDomain.trim().replace(/^https?:\/\//,'').replace(/\/+$/,'').toLowerCase();
 if(!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host))throw new Error('Invalid Access team domain');
 return 'https://'+host;
}

const defaultFetch:KeyFetcher=async url=>{
 const response=await fetch(url,{headers:{Accept:'application/json'}});
 if(!response.ok)throw new Error('Access certificates: HTTP '+response.status);
 return response.json();
};
let cache:{url:string;keys:Map<string,CryptoKey>;fetched:number}|null=null;
async function keyFor(url:string,kid:string,fetchKeys:KeyFetcher,now:number){
 // Refresh hourly, and early when an unknown key ID appears (key rotation),
 // but at most once a minute so forged key IDs cannot trigger a fetch per request.
 const stale=!cache||cache.url!==url||now-cache.fetched>3600_000;
 if(stale||(!cache!.keys.has(kid)&&now-cache!.fetched>60_000)){
  let keys:Jwk[];
  try{({keys}=await fetchKeys(url))}catch(error){throw new AccessKeysUnavailable(error instanceof Error?error.message:'Access certificates unavailable')}
  const imported=new Map<string,CryptoKey>();
  for(const key of keys??[]){
   if(!key.kid||key.kty!=='RSA')continue;
   imported.set(key.kid,await crypto.subtle.importKey('jwk',{kty:key.kty,n:key.n,e:key.e,alg:'RS256',ext:true},{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']));
  }
  cache={url,keys:imported,fetched:now};
 }
 return cache!.keys.get(kid);
}

/** Test hook: forget cached signing keys. */
export function resetAccessKeyCache(){cache=null}
export async function verifyAccessJwt(token:string,options:{teamDomain:string;aud:string;now?:number;fetchKeys?:KeyFetcher}):Promise<AccessClaims|null>{
 const now=options.now??Date.now();
 try{
  const parts=token.split('.');if(parts.length!==3)return null;
  const header=json(parts[0]);if(header.alg!=='RS256'||typeof header.kid!=='string')return null;
  const issuer=teamOrigin(options.teamDomain);
  const key=await keyFor(issuer+'/cdn-cgi/access/certs',header.kid,options.fetchKeys??defaultFetch,now);
  if(!key)return null;
  const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,base64url(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  if(!valid)return null;
  const claims=json(parts[1]);
  const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(claims.iss!==issuer||!audiences.includes(options.aud.trim()))return null;
  const seconds=now/1000;
  if(typeof claims.exp!=='number'||claims.exp<=seconds-60)return null;
  if(typeof claims.nbf==='number'&&claims.nbf>seconds+60)return null;
  if(typeof claims.sub!=='string'||!claims.sub||typeof claims.email!=='string'||!claims.email.includes('@'))return null;
  return {sub:claims.sub,email:claims.email};
 }catch(error){
  if(error instanceof AccessKeysUnavailable)throw error;
  return null;
 }
}
