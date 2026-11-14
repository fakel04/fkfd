import {AccessError} from './access-store.ts';

export async function readMaterialBody(request:Request,limit:number){
 if(Number(request.headers.get('content-length')||0)>limit)throw new AccessError('Слишком большой запрос.',413);
 const reader=request.body?.getReader();if(!reader)throw new AccessError('Пустой запрос.',400);
 const chunks:Uint8Array[]=[];let total=0;
 while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>limit){await reader.cancel();throw new AccessError('Слишком большой запрос.',413)}chunks.push(value)}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return bytes;
}
