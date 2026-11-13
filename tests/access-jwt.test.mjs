import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAccessJwt,resetAccessKeyCache,teamOrigin,AccessKeysUnavailable} from '../app/access-jwt.ts';

const team='oblaka.cloudflareaccess.com',aud='aud-tag-123',now=Date.UTC(2026,10,13)/1000;
const b64=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
async function keyPair(kid){
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 return {kid,privateKey:pair.privateKey,jwk:{...await crypto.subtle.exportKey('jwk',pair.publicKey),kid}};
}
async function sign(key,claims,header={}){
 const head=b64({alg:'RS256',kid:key.kid,typ:'JWT',...header}),body=b64(claims);
 const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key.privateKey,new TextEncoder().encode(head+'.'+body));
 return head+'.'+body+'.'+Buffer.from(signature).toString('base64url');
}
const claims=(extra={})=>({iss:'https://'+team,aud:[aud],sub:'user-1',email:'owner@example.com',exp:now+600,iat:now,...extra});
const key=await keyPair('k1'),other=await keyPair('k2');
const options=(extra={})=>({teamDomain:team,aud,now:now*1000,fetchKeys:async()=>({keys:[key.jwk]}),...extra});

test('a valid Access token yields the subject and email',async()=>{
 resetAccessKeyCache();
 assert.deepEqual(await verifyAccessJwt(await sign(key,claims()),options()),{sub:'user-1',email:'owner@example.com'});
 // A single-string aud and a team domain written as a URL are both accepted.
 assert.ok(await verifyAccessJwt(await sign(key,claims({aud})),options({teamDomain:'https://'+team.toUpperCase()+'/'})));
});

test('forged, foreign, expired and malformed tokens are rejected',async()=>{
 resetAccessKeyCache();
 const reject=async(token,extra)=>assert.equal(await verifyAccessJwt(token,options(extra)),null);
 await reject(await sign(other,claims(),{kid:'k1'}));                    // wrong signing key
 await reject(await sign(key,claims({aud:['another-app']})));           // other Access application
 await reject(await sign(key,claims({iss:'https://evil.cloudflareaccess.com'})));
 await reject(await sign(key,claims({exp:now-120})));                   // expired
 await reject(await sign(key,claims({nbf:now+600})));                   // not yet valid
 await reject(await sign(key,claims({email:undefined})));
 await reject(await sign(key,claims(),{alg:'HS256'}));                  // algorithm confusion
 const valid=await sign(key,claims());const [h,,s]=valid.split('.');
 await reject(h+'.'+b64(claims({email:'attacker@example.com'}))+'.'+s); // edited payload
 await reject('not-a-jwt');await reject('a.b');await reject('');
});

test('rotated keys are fetched, but unknown key IDs cannot force a fetch per request',async()=>{
 resetAccessKeyCache();let fetches=0;const rotating={fetchKeys:async()=>{fetches++;return {keys:fetches===1?[key.jwk]:[key.jwk,other.jwk]}}};
 assert.ok(await verifyAccessJwt(await sign(key,claims()),options(rotating)));assert.equal(fetches,1);
 // Unknown kid within a minute of the last fetch: no new request.
 assert.equal(await verifyAccessJwt(await sign(other,claims()),options(rotating)),null);assert.equal(fetches,1);
 assert.ok(await verifyAccessJwt(await sign(other,claims()),options({...rotating,now:(now+120)*1000})));assert.equal(fetches,2);
});

test('a key server outage is reported as unavailable, not as a sign-out',async()=>{
 resetAccessKeyCache();
 await assert.rejects(verifyAccessJwt(await sign(key,claims()),options({fetchKeys:async()=>{throw new Error('502')}})),AccessKeysUnavailable);
 assert.throws(()=>teamOrigin('bad domain'));
});
