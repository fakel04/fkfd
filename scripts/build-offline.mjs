import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve('dist/client');
async function files(dir){return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?files(path.join(dir,e.name)):path.join(dir,e.name)))).flat()}
const paths=(await files(root)).map(f=>'/'+path.relative(root,f).split(path.sep).join('/')).filter(p=>/^\/(?:_next\/static\/|assets\/|icons\/)/.test(p)||['/favicon.ico','/apple-touch-icon.png','/site.webmanifest'].includes(p)).filter(p=>!p.endsWith('.map')).sort();
if(!paths.some(p=>p.endsWith('.js')))throw new Error('No client JavaScript found for offline bundle');
const hash=createHash('sha256');for(const name of paths){hash.update(name);hash.update(await readFile(path.join(root,name)))}
await writeFile(path.join(root,'offline-assets.json'),JSON.stringify({version:hash.digest('hex').slice(0,16),assets:paths}));
await writeFile(path.join(root,'_headers'),(await readFile(path.join(root,'_headers'),'utf8'))+'\n/sw.js\n  Cache-Control: no-cache\n/offline-assets.json\n  Cache-Control: no-store\n');
console.log(`Offline bundle prepared: ${paths.length} static assets`);
