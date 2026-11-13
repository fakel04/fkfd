import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('public/sw.js','utf8');
function worker(){
 const events={},jobs=[],pending=[];const stores=new Map();let online=true,login=false,badAsset=false,stalled=false,fetches=0;let version='0123456789abcdef';let asset='/_next/static/main.js';let shell='<html><head><script src="/_next/static/main.js"></script></head><body>Открываем облака</body></html>';
 const caches={async keys(){return [...stores.keys()]},async open(name){if(!stores.has(name))stores.set(name,new Map());const s=stores.get(name);return{async match(path){return s.get(path)?.clone()},async put(path,response){s.set(path,response.clone())}}}};
 const fetch=async(request,options={})=>{fetches++;if(stalled)return new Promise((_,reject)=>{pending.push(reject);options.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})});if(!online)throw new TypeError('offline');const path=typeof request==='string'?request:new URL(request.url).pathname;
  if(path==='/offline-assets.json')return Response.json({version,assets:[asset]});
  if(path===asset)return new Response(badAsset?'<html>Login</html>':'console.log("app")',{headers:{'content-type':badAsset?'text/html':'text/javascript'}});
  return new Response(login?'<html>Sign in</html>':shell,{status:login?401:200,headers:{'content-type':'text/html'}});
 };
 const context={self:{location:{origin:'https://site.test'},async skipWaiting(){},clients:{async claim(){}},addEventListener:(name,fn)=>events[name]=fn},caches,fetch,Response,URL,AbortController,setTimeout,clearTimeout};vm.runInNewContext(source,context);
 async function prepare(assets){let job,result;events.message({data:{type:'PREPARE_OFFLINE',assets},ports:[{postMessage:r=>result=r}],waitUntil:p=>job=p});await job;return result}
 return{
  async prepare(){return (await prepare()).ready},report:prepare,
  async navigate(path='/',mode='navigate',method='GET'){let response;events.fetch({request:{url:'https://site.test'+path,method,mode},respondWith:p=>response=p,waitUntil:p=>jobs.push(p)});return response?await response:null},
  async background(){await Promise.all(jobs)},
  online(v){online=v},login(v){login=v},badAsset(v){badAsset=v},stall(){stalled=true},get fetches(){return fetches},
  unstall(){stalled=false;for(const reject of pending)reject(new Error('connection ended'))},
  release(v){version=v;const next='/_next/static/main-'+v+'.js';shell=shell.replace(asset,next).replace('</body>',v+'</body>');asset=next},stores,
 };
}
test('prepared shell and static bundle reopen without any network',async()=>{const w=worker();assert.equal(await w.prepare(),true);w.online(false);assert.match(await (await w.navigate()).text(),/Открываем облака/);assert.match(await (await w.navigate('/_next/static/main.js','cors')).text(),/console/)});
test('API, MCP, admin and authentication routes are never intercepted or cached',async()=>{const w=worker();await w.prepare();w.online(false);for(const path of ['/api/board','/api/board/sync','/mcp','/admin','/signin-with-chatgpt','/signout-with-chatgpt'])assert.equal(await w.navigate(path),null);assert.equal(await w.navigate('/','navigate','POST'),null);const stored=[...w.stores.values()].flatMap(s=>[...s.keys()]);assert.equal(stored.some(p=>p.startsWith('/api')),false)});
test('prepared shell opens immediately while background update fetch is stalled',async()=>{
 const w=worker();await w.prepare();const calls=w.fetches;w.stall();
 let timer;try{
  const response=await Promise.race([w.navigate(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('cached shell waited for network')),500)})]);
  assert.match(await response.text(),/Открываем облака/);
  assert.match(await (await w.navigate('/_next/static/main.js','cors')).text(),/console/);assert.equal(w.fetches,calls+1);
 }finally{clearTimeout(timer);w.unstall();await w.background()}
});
test('cached shell contains no account data; auth API remains network-only and fresh login walls are not cached',async()=>{
 const w=worker();await w.prepare();w.login(true);
 assert.match(await (await w.navigate()).text(),/Открываем облака/);assert.equal(await w.navigate('/api/board'),null);
 const fresh=worker();fresh.login(true);assert.equal((await fresh.navigate()).status,401);assert.equal(await fresh.prepare(),false);
});
test('online preparation makes the newest complete shell available on the next launch',async()=>{
 const w=worker();await w.prepare();w.release('fedcba9876543210');assert.equal(await w.prepare(),true);w.online(false);
 assert.match(await (await w.navigate()).text(),/fedcba9876543210/);
});
test('a failed asset download or login wall never makes an offline bundle ready',async()=>{const w=worker();w.badAsset(true);assert.equal(await w.prepare(),false);w.online(false);assert.equal((await w.navigate()).status,503);const other=worker();other.login(true);assert.equal(await other.prepare(),false)});
test('an old complete shell survives a failed refresh',async()=>{const w=worker();await w.prepare();w.release('fedcba9876543210');w.login(true);assert.equal(await w.prepare(),true);w.online(false);assert.match(await (await w.navigate()).text(),/Открываем облака/)});
test('opening a legacy cached page prepares the new interface without any board sync or client message',async()=>{
 const w=worker();await w.prepare();w.release('fedcba9876543210');
 await w.navigate();await w.background();w.online(false);
 assert.match(await (await w.navigate()).text(),/fedcba9876543210/);
});
test('only a complete changed bundle signals a safe update; old clients remain compatible',async()=>{
 const w=worker();const current=['/_next/static/main.js'];
 assert.equal((await w.report(current)).updated,false);
 w.release('fedcba9876543210');w.badAsset(true);
 const failed=await w.report(current);assert.equal(failed.ready,true);assert.equal(failed.updated,false);assert.equal(failed.version,null);
 w.badAsset(false);const fresh=await w.report(current);
 assert.equal(fresh.updated,true);assert.equal(fresh.version,'fedcba9876543210');
 assert.equal((await w.report(['/_next/static/main-fedcba9876543210.js'])).updated,false);
 assert.equal((await w.report()).updated,false);
});
