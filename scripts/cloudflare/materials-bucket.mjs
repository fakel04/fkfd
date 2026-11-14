/** Provision a private bucket. Nothing here enables public R2 access. */
export async function ensureMaterialsBucket({accountId,token,name,fetchImpl=fetch}){
 const base=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets`;
 const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 let response=await fetchImpl(base+'/'+encodeURIComponent(name),{headers});
 if(response.ok)return name;
 if(response.status===404)response=await fetchImpl(base,{method:'POST',headers,body:JSON.stringify({name})});
 if(!response.ok)throw new Error('Не удалось подключить R2 для вложений. Включите R2 в Cloudflare и выдайте токену публикации право Account · Workers R2 Storage · Edit, затем повторите публикацию.');
 return name;
}
