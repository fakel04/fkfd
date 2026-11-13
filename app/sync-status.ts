import type {OfflineState} from './offline-controller.ts';
import {BOARD_TOO_LARGE} from './board-model.ts';
export function syncNotice(state:OfflineState){
 // Saving, offline work and background retries are quiet. Only actionable
 // failures interrupt the board; detailed status is available on the avatar.
 if(state.tooLarge)return {kind:'error',message:BOARD_TOO_LARGE} as const;
 if(state.error)return {kind:'error',message:state.error} as const;
 return null;
}
