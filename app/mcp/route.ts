import {env} from 'cloudflare:workers';
import {requireSession} from '../server-access';
import {readSharedBoard} from '../board-store';
import {handleMcpRequest} from '../mcp-protocol';
export const dynamic='force-dynamic';
export async function POST(request:Request){return handleMcpRequest(request,{authorize:requireSession,read:session=>readSharedBoard(env.DB!,session)})}
export function GET(){return new Response(null,{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}})}
