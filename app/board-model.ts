import { z } from 'zod';
import {validDate} from './task-due.ts';
import {normalizeAiLink,type AiProvider} from './task-ai-links.ts';

export type TaskOrigin = { noteId: string; title: string; color: string; category: string; index: number; nextTaskId?: string };
export type TodoistTaskMeta = { id:string; projectId:string; sectionId?:string; parentId?:string; parentTitle?:string; description:string; dueDate?:string; deadlineDate?:string; labels:string[]; priority:string; recurring:boolean|string; duration?:string; addedAt?:string };
export type ImportReceipt = { id:string; at:string; taskCount:number; noteCount:number; taskIds:string[] };
export type TaskParent = { taskId:string; title:string };
export type Task = { id: string; text: string; done: boolean; gptUrl?:string|null; claudeUrl?:string|null; labels?: string[]; dueDate?: string|null; description?:string; parent?:TaskParent|null; pinned?: boolean; focused?: boolean; origin?: TaskOrigin; todoist?:TodoistTaskMeta };
export type Note = { id: string; title: string; text: string; tasks: Task[]; labels?: string[]; color: string; category: string; pinned: boolean; archived: boolean; deleted: boolean; example?: boolean; created: string; kind?: 'focus'; todoist?:{ projectId:string; sectionId?:string; projectName:string; sectionName?:string } };
export type Board = { notes: Note[]; categories: string[]; labels?: string[]; imports?:ImportReceipt[] };
export const FOCUS_NOTE_ID = '__focus_tasks__';
// The whole board is one D1 row, and D1 rejects rows over 2,000,000 bytes.
// Keep headroom for the other columns and UTF-8 overhead of the row itself.
export const MAX_BOARD_BYTES = 1_900_000;
export const BOARD_TOO_LARGE = 'Доска слишком большая: в хранилище помещается до 1,9 МБ. Изменение не сохранено — скачайте копию доски и сократите её объём.';
export const boardBytes = (board: unknown) => new TextEncoder().encode(typeof board === 'string' ? board : JSON.stringify(board)).length;
export const isFocusNote = (note: Note) => note.id === FOCUS_NOTE_ID;

export const labelKey = (label: string) => label.trim().normalize('NFKC').toLocaleLowerCase('ru-RU');
export function uniqueLabels(labels: string[]): string[] {
 const seen = new Set<string>();
 return labels.map(label=>label.trim()).filter(label=>{
  const key=labelKey(label);if(!key||seen.has(key))return false;seen.add(key);return true;
 });
}
// An explicit empty array removes imported labels; missing labels use the import.
export const taskLabels = (task: Task): string[] => task.labels ?? task.todoist?.labels ?? [];
export const taskDescription = (task: Task): string => task.description ?? task.todoist?.description ?? '';
export const taskDueDate = (task: Task): string|null => task.dueDate !== undefined ? task.dueDate : task.todoist?.dueDate || null;
export const hasLabel = (labels: string[] | undefined, label: string) => (labels??[]).some(value=>labelKey(value)===labelKey(label));
export const noteHasLabel = (note: Note, label: string) => note.tasks.some(task=>hasLabel(taskLabels(task),label));
// Categories and cloud names are deliberately not tag suggestions.
export const boardLabels = (board: Board): string[] => uniqueLabels([
 ...(board.labels??[]),...board.notes.flatMap(note=>note.tasks.flatMap(taskLabels))
]).sort((a,b)=>a.localeCompare(b,'ru'));
export const preserveLabelCatalog = (board: Board, previous: Board): Board => ({...board,labels:boardLabels({...board,labels:[...boardLabels(previous),...(board.labels??[])]})});
const labelsSchema=z.array(z.string().trim().min(1).max(100)).max(100);

const originSchema = z.object({ noteId:z.string().max(100), title:z.string().max(300), color:z.string().max(30), category:z.string().max(60), index:z.number().int().min(0), nextTaskId:z.string().max(100).optional() });
const todoistMetaSchema=z.object({id:z.string().max(100),projectId:z.string().max(100),sectionId:z.string().max(100).optional(),parentId:z.string().max(100).optional(),parentTitle:z.string().max(10000).optional(),description:z.string().max(50000),dueDate:z.string().max(100).optional(),deadlineDate:z.string().max(100).optional(),labels:z.array(z.string().max(100)).max(100),priority:z.string().max(10),recurring:z.union([z.boolean(),z.string().max(300)]),duration:z.string().max(100).optional(),addedAt:z.string().max(100).optional()});
const aiLinkSchema=(provider:AiProvider)=>z.string().max(2048).transform((value,ctx)=>{try{return normalizeAiLink(provider,value)}catch(error){ctx.addIssue({code:z.ZodIssueCode.custom,message:error instanceof Error?error.message:'Неверная ссылка'});return z.NEVER}}).nullable().optional();
export const taskSchema = z.object({ gptUrl:aiLinkSchema('gpt'), claudeUrl:aiLinkSchema('claude'), id:z.string().max(100), text:z.string().max(10000), done:z.boolean(), description:z.string().max(50000).optional(), parent:z.object({taskId:z.string().min(1).max(100),title:z.string().max(10000)}).nullable().optional(), labels:labelsSchema.optional(), dueDate:z.union([z.string().refine(validDate),z.string().datetime({offset:true})]).nullable().optional(), pinned:z.boolean().optional(), focused:z.boolean().optional(), origin:originSchema.optional(), todoist:todoistMetaSchema.optional() });
export const noteSchema = z.object({ id:z.string().max(100), title:z.string().max(300), text:z.string().max(50000), tasks:z.array(taskSchema).max(500), labels:labelsSchema.optional(), color:z.enum(['white','lavender','peach','sage','blue','yellow']), category:z.string().max(60), pinned:z.boolean(), archived:z.boolean(), deleted:z.boolean(), example:z.boolean().optional(), created:z.string().max(50), kind:z.literal('focus').optional(),todoist:z.object({projectId:z.string().max(100),sectionId:z.string().max(100).optional(),projectName:z.string().max(300),sectionName:z.string().max(300).optional()}).optional() });
export const boardSchema = z.object({ notes:z.array(noteSchema).max(2000), categories:z.array(z.string().min(1).max(60)).max(50),labels:z.array(z.string().trim().min(1).max(100)).max(2000).optional(),imports:z.array(z.object({id:z.string().max(100),at:z.string().max(50),taskCount:z.number().int().min(0),noteCount:z.number().int().min(0),taskIds:z.array(z.string().max(100)).max(20000)})).max(100).optional() });

export function focusNote(): Note {
  return { id:FOCUS_NOTE_ID, kind:'focus', title:'Задачи', text:'', tasks:[], color:'sage', category:'', pinned:true, archived:false, deleted:false, created:'2026-11-12T00:00:00Z' };
}
export function ensureFocusBoard(board: Board): Board {
  if (board.notes.some(isFocusNote)) return board;
  return { ...board, notes:[focusNote(), ...board.notes] };
}
export function sourceTitle(board: Board, task: Task): string {
  return board.notes.find(note => note.id === task.origin?.noteId)?.title || task.origin?.title || 'Без названия';
}
export function moveToFocus(board: Board, noteId: string, taskId: string): Board {
  const base = ensureFocusBoard(board);
  const source = base.notes.find(note => note.id === noteId);
  const task = source?.tasks.find(item => item.id === taskId);
  if (!source || !task || isFocusNote(source)) return base;
  const index = source.tasks.indexOf(task);
  const active: Task = { ...task, focused:true, origin:{ noteId:source.id, title:source.title || 'Без названия', color:source.color, category:source.category, index, nextTaskId:source.tasks[index + 1]?.id } };
  return { ...base, notes:base.notes.map(note => note.id === source.id
    ? { ...note, tasks:note.tasks.filter(item => item.id !== taskId) }
    : isFocusNote(note) ? { ...note, archived:false, deleted:false, tasks:[...note.tasks, active] } : note) };
}
export function returnFromFocus(board: Board, taskId: string): Board {
  const task = board.notes.find(isFocusNote)?.tasks.find(item => item.id === taskId);
  if (!task?.origin) return board;
  const origin = task.origin;
  const { focused: _focused, origin: _origin, ...restored } = task;
  let notes = board.notes.map(note => isFocusNote(note) ? { ...note, tasks:note.tasks.filter(item => item.id !== taskId) } : note);
  if (!notes.some(note => note.id === origin.noteId)) {
    notes = [...notes, { id:origin.noteId, title:origin.title, color:origin.color, category:origin.category, text:'', tasks:[], pinned:false, archived:false, deleted:false, created:new Date().toISOString() }];
  }
  return { ...board, notes:notes.map(note => {
    if (note.id !== origin.noteId) return note;
    const tasks = [...note.tasks];
    const next = tasks.findIndex(item => item.id === origin.nextTaskId);
    tasks.splice(next >= 0 ? next : Math.min(origin.index, tasks.length), 0, restored);
    return { ...note, archived:false, deleted:false, tasks };
  }) };
}

export const pinnedFirst = (tasks: Task[]) => [...tasks].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned));
export function moveTaskToCloud(board: Board, fromId: string, taskId: string, toId: string): Board {
 if(fromId===toId)return board;
 if(toId===FOCUS_NOTE_ID)return moveToFocus(board,fromId,taskId);
 const source=board.notes.find(n=>n.id===fromId), target=board.notes.find(n=>n.id===toId);
 const task=source?.tasks.find(t=>t.id===taskId);
 if(!task||!target||target.deleted||target.archived||target.tasks.length>=500)return board;
 if(fromId===FOCUS_NOTE_ID&&task.origin?.noteId===toId)return returnFromFocus(board,taskId);
 const {focused:_focused,origin:_origin,...moved}=task;
 return {...board,notes:board.notes.map(n=>n.id===fromId?{...n,tasks:n.tasks.filter(t=>t.id!==taskId)}:n.id===toId?{...n,tasks:[...n.tasks,moved]}:n)};
}
