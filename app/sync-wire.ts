// Compress the rare full-snapshot fallback (old offline queue or concurrent edits).
// Use an explicit media type so proxies cannot transparently decode it twice.
export async function encodeSyncBody(value:unknown):Promise<{body:BodyInit;headers:Record<string,string>}>{
 const json=JSON.stringify(value);
 if(json.length>=4096&&typeof CompressionStream!=='undefined'){
  try{
   const body=await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
   if(body.byteLength<new TextEncoder().encode(json).length)return {body,headers:{'Content-Type':'application/vnd.oblaka.sync+gzip'}};
  }catch{/* Older browsers can safely use the ordinary JSON protocol. */}
 }
 return {body:json,headers:{'Content-Type':'application/json'}};
}
export async function decodeSyncBody(request:Request):Promise<unknown>{
 let stream=request.body;if(!stream)throw new Error('Empty request');
 if(request.headers.get('content-type')==='application/vnd.oblaka.sync+gzip')stream=stream.pipeThrough(new DecompressionStream('gzip'));
 const reader=stream.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8000000)throw new Error('Request too large');chunks.push(value)}
 }finally{await reader.cancel().catch(()=>{})}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 return JSON.parse(new TextDecoder().decode(bytes));
}
