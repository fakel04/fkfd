import {env} from 'cloudflare:workers';
import {requireSession,apiError} from '../../../server-access';
import {tasksWithFiles} from '../../../task-materials-store';

/** IDs of the tasks (visible to this person) that have an attached file. */
export async function GET(){
 try{const session=await requireSession();return Response.json({taskIds:await tasksWithFiles(env.DB!,session)},{headers:{'Cache-Control':'private, no-store'}})}catch(error){return apiError(error)}
}
