import {requireSession,apiError} from '../../server-access';
export async function GET(){try{return Response.json(await requireSession(),{headers:{'Cache-Control':'no-store'}})}catch(error){return apiError(error)}}
