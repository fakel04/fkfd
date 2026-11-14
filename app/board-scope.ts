import {boardLabels,isFocusNote,type Board,type Note,type Task} from './board-model.ts';
import type {SyncOperation} from './board-merge.ts';

// Per-cloud access for members. `scope` is the set of granted cloud ids; null means
// "sees everything" (owner and admins). The shared «Задачи» list is visible to everyone,
// but a member sees only the tasks whose source cloud (`origin`) is granted to them.

const visibleTask=(note:Note,task:Task,allowed:(id:string)=>boolean)=>
 isFocusNote(note)?!!task.origin&&allowed(task.origin.noteId):allowed(note.id);

/** The board as a member sees it. Import receipts and other clouds' tag names are not shown. */
export function filterBoard(board:Board,scope:ReadonlySet<string>|null):Board{
 if(!scope)return board;
 const allowed=(id:string)=>scope.has(id);
 const notes=board.notes.filter(note=>isFocusNote(note)||allowed(note.id))
  .map(note=>isFocusNote(note)?{...note,tasks:note.tasks.filter(task=>visibleTask(note,task,allowed))}:note);
 const {imports:_imports,labels:_labels,...rest}=board;
 const view:Board={...rest,notes};
 const labels=boardLabels(view);if(labels.length)view.labels=labels;
 return view;
}

/**
 * Restricts a member's operation to what that member may change, before the
 * three-way merge with the full board. Anything outside the member's clouds is
 * removed from both `base` and `data`, so the merge leaves it untouched: hidden
 * clouds and tasks can be neither read nor changed, even by a forged request,
 * and an edit queued offline before access was revoked is dropped, not stuck.
 * New clouds (ids unknown to the server) are allowed and returned for granting.
 */
export function scopeOperation(current:Board,operation:SyncOperation,scope:ReadonlySet<string>):{operation:SyncOperation;newNoteIds:string[]}{
 const existing=new Set(current.notes.map(note=>note.id));
 const newNoteIds=operation.data.notes.map(note=>note.id).filter(id=>!existing.has(id));
 const fresh=new Set(newNoteIds);
 const allowed=(id:string)=>scope.has(id)||fresh.has(id);
 // Tasks the member cannot see on the server must not appear (or move) in their operation.
 const hidden=new Set<string>();
 for(const note of current.notes)for(const task of note.tasks)if(!visibleTask(note,task,allowed))hidden.add(task.id);
 const restrict=(board:Board):Board=>{
  const {imports:_imports,...rest}=board;
  return {...rest,notes:board.notes
   .filter(note=>isFocusNote(note)||allowed(note.id)||!existing.has(note.id))
   .map(note=>({...note,tasks:note.tasks.filter(task=>!hidden.has(task.id)&&(!isFocusNote(note)||visibleTask(note,task,id=>allowed(id)||!existing.has(id))))}))};
 };
 return {operation:{...operation,base:restrict(operation.base),data:restrict(operation.data)},newNoteIds};
}
