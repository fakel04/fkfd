import type {OfflineState} from './offline-controller.ts';
export function syncNotice(state:OfflineState){
 // Saving, offline work and background retries are quiet. Only actionable
 // failures interrupt the board; detailed status is available on the avatar.
 if(state.error)return {kind:'error',message:state.error} as const;
 return null;
}
