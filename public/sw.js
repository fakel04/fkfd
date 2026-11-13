/* Only the generic application shell and immutable static assets are cached.
 * User records live in account-scoped IndexedDB, never in the HTTP cache. */
const PREFIX='oblaka-shell-v1-';
const READY='/__oblaka_offline_ready__';
const staticPath=path=>/^\/(?:_next\/static\/|assets\/|icons\/)/.test(path)||['/favicon.ico','/apple-touch-icon.png','/site.webmanifest'].includes(path);
const valid=response=>response.ok&&!response.redirected&&response.type!=='opaqueredirect';
async function readyCaches(){const names=(await caches.keys()).filter(n=>n.startsWith(PREFIX)).reverse();const ready=[];for(const name of names){const cache=await caches.open(name);if(await cache.match(READY))ready.push(cache)}return ready}
async function prepare(signal){
 const manifestResponse=await fetch('/offline-assets.json',{cache:'no-store',redirect:'error',signal});
 if(!valid(manifestResponse)||!manifestResponse.headers.get('content-type')?.includes('json'))throw new Error('manifest');
 const manifest=await manifestResponse.json();
 if(!/^[a-f0-9]{16}$/.test(manifest.version)||!Array.isArray(manifest.assets)||!manifest.assets.length||manifest.assets.some(p=>typeof p!=='string'||!staticPath(p)||p.includes('..')||p.includes('?')))throw new Error('assets');
 const cache=await caches.open(PREFIX+manifest.version);
 if(await cache.match(READY))return manifest;
 // A completed cache stays usable during a refresh. Incomplete caches are never used.
 for(const path of manifest.assets){
  if(await cache.match(path))continue;
  const response=await fetch(path,{cache:'reload',redirect:'error',signal});
  if(!valid(response)||response.headers.get('content-type')?.includes('text/html'))throw new Error('asset');
  await cache.put(path,response);
 }
 const response=await fetch('/',{cache:'no-store',redirect:'error',headers:{Accept:'text/html'},signal});
 if(!valid(response)||!response.headers.get('content-type')?.includes('text/html'))throw new Error('shell');
 const html=await response.clone().text();
 // Never save a sign-in wall or a partial/RSC response as the application shell.
 if(!html.includes('Открываем облака')||!html.includes('<html'))throw new Error('not app shell');
 const refs=[...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m=>m[1]).filter(p=>staticPath(p));
 if(refs.some(p=>!manifest.assets.includes(p)))throw new Error('build changed');
 await cache.put('/',response);await cache.put(READY,new Response('ready'));
 return manifest;
}
let preparing;
function refresh(){
 if(!preparing){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
  preparing=prepare(controller.signal).finally(()=>{clearTimeout(timeout);preparing=null});
 }
 return preparing;
}
// Activating the cache worker does not reload the page or disturb an open editor.
// The page decides when a fully prepared interface can safely replace itself.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
 if(event.data?.type!=='PREPARE_OFFLINE')return;
 event.waitUntil((async()=>{
  let ready=false,version=null,updated=false;
  try{
   const manifest=await refresh();ready=true;version=manifest.version;
   const current=event.data.assets;
   updated=Array.isArray(current)&&current.length>0&&current.some(path=>typeof path==='string'&&staticPath(path)&&!manifest.assets.includes(path));
  }catch{ready=(await readyCaches()).length>0}
  event.ports[0]?.postMessage({ready,version,updated});
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(request.mode==='navigate'&&url.pathname==='/'&&!url.search){
  // Refresh independently of board synchronization, without delaying offline opening.
  event.waitUntil(refresh().catch(()=>{}));
  event.respondWith((async()=>{
   // This HTML contains no user data. Serve the complete local shell immediately;
   // the app revalidates identity and refreshes its static bundle in the background.
   // Do not put a network timeout in front of an already prepared offline launch.
   for(const cache of await readyCaches()){const shell=await cache.match('/');if(shell)return shell}
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
   try{return await fetch(request,{signal:controller.signal})}catch{
    return new Response('Для первого открытия «Облаков» нужен интернет.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});
   }finally{clearTimeout(timeout)}
  })());return;
 }
 if(staticPath(url.pathname)&&!url.search){event.respondWith((async()=>{
  for(const cache of await readyCaches()){const asset=await cache.match(url.pathname);if(asset)return asset}
  return fetch(request);
 })())}
 // /api, /mcp, /admin and all authentication routes always go to the network.
});
