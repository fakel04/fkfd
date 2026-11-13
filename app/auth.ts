import {env} from 'cloudflare:workers';
import {headers} from 'next/headers';
import {getChatGPTUser} from './chatgpt-auth';
import {verifyAccessJwt,AccessKeysUnavailable} from './access-jwt';
import {AccessError} from './access-store';
import type {Identity} from './access-model';

/**
 * Production identity comes only from a verified Cloudflare Access token.
 * Local development keeps the loopback-only mock sign-in (/signin-with-chatgpt).
 * Without Access configuration a deployed site stays locked: nobody is signed in.
 */
export async function getUser():Promise<Identity|null>{
 const teamDomain=env.ACCESS_TEAM_DOMAIN?.trim(),aud=env.ACCESS_AUD?.trim();
 if(teamDomain&&aud){
  const token=(await headers()).get('cf-access-jwt-assertion');
  if(!token)return null;
  try{
   const claims=await verifyAccessJwt(token,{teamDomain,aud});
   // Prefix keeps Access subjects distinct from any other identity provider.
   return claims?{userId:'access:'+claims.sub,email:claims.email,displayName:claims.email}:null;
  }catch(error){
   if(error instanceof AccessKeysUnavailable)throw new AccessError('Сервис входа временно недоступен. Повторите попытку позже.',503);
   throw error;
  }
 }
 if(import.meta.env.DEV){
  const user=await getChatGPTUser();
  return user?{userId:user.userId,email:user.email,displayName:user.displayName}:null;
 }
 return null;
}
