'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { GripVertical, ChevronRight } from 'lucide-react';
import { TaskCheckbox } from './task-checkbox';
import { TaskInput } from './task-input';
import { TaskMarkers } from './task-markers';
import { TaskDetails } from './task-details';
import { useTaskCompletionMotion } from './use-task-completion-motion';
import { pinnedFirst, type Task } from './board-model';
import { SwipeTask } from './swipe-task';
import { splitTask, splitTaskLines, type TaskBreak } from './task-list-edit';
import {reorderTasks} from './task-sort';
import {TaskLift,captureTaskLayout,animateTaskLayout} from './task-motion';

type Drag = {
  id: string; pointerId: number; startX: number; startY: number;
  x: number; y: number; active: boolean; handle: HTMLButtonElement; lift?:TaskLift;
};

export function EditorTaskList({ tasks, onChange, onToggleFocus, onMoveToCloud, onMore, getSourceTitle, getParentTitle, focusMode=false, readOnly=false, filesOn }: { filesOn?: ReadonlySet<string>; tasks: Task[]; onChange: (tasks: Task[],group?:string) => void; onToggleFocus?: (id:string)=>void; getSourceTitle?: (task:Task)=>string; getParentTitle?: (task:Task)=>string|undefined; onMoveToCloud:(id:string)=>void; onMore:(id:string)=>void; focusMode?:boolean;readOnly?:boolean }) {
  const motion = useTaskCompletionMotion(tasks);
  const root = useRef<HTMLDivElement>(null);
  const current = useRef({ tasks, onChange, readOnly });
  current.current = { tasks, onChange, readOnly };
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const landing=useRef<(()=>void)|null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const activeTasks = pinnedFirst(tasks.filter(task => !task.done));
  const completedTasks = tasks.filter(task => task.done);

  function stop(commit?:()=>void) {
    const d = drag.current;
    drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if(d?.lift)landing.current=d.lift.finish(commit);
    if (d?.handle.hasPointerCapture(d.pointerId)) d.handle.releasePointerCapture(d.pointerId);
  }

  function animate() {
    const d = drag.current;
    if (!d?.active) return;
    const panel = root.current?.closest<HTMLElement>('.modal-panel');
    if (panel) {
      const bounds = panel.getBoundingClientRect();
      const edge = 62;
      if (d.x >= bounds.left && d.x <= bounds.right) {
        if (d.y < bounds.top + edge) panel.scrollTop -= Math.min(12, (bounds.top + edge - d.y) / 4);
        else if (d.y > bounds.bottom - edge) panel.scrollTop += Math.min(12, (d.y - bounds.bottom + edge) / 4);
      }
    }
    d.lift?.move(d.x,d.y);
    frame.current = requestAnimationFrame(animate);
  }

  useEffect(() => {
    function move(event: PointerEvent) {
      const d = drag.current;
      if (!d || d.pointerId !== event.pointerId) return;
      d.x = event.clientX; d.y = event.clientY;
      if (!d.active && Math.hypot(d.x - d.startX, d.y - d.startY) >= 5) {
        const row=d.handle.closest<HTMLElement>('[data-editor-task-id]');
        if(!root.current||!row)return;
        d.active = true;
        d.lift=new TaskLift(root.current,row,d.startX,d.startY,id=>!!current.current.tasks.find(task=>task.id===id)?.pinned);
        frame.current = requestAnimationFrame(animate);
      }
      if (d.active) event.preventDefault();
    }
    function end(event: PointerEvent) {
      const d = drag.current;
      if (!d || d.pointerId !== event.pointerId) return;
      d.x = event.clientX; d.y = event.clientY;
      const index = d.active ? d.lift?.move(d.x,d.y) : null;
      if(index!=null&&index>=0&&!current.current.readOnly){
        const all=current.current.tasks;
        const active=reorderTasks(pinnedFirst(all.filter(task=>!task.done)),d.id,index);
        stop(()=>flushSync(()=>current.current.onChange([...active,...all.filter(task=>task.done)])));
        setAnnouncement(`Задача перемещена на позицию ${index+1}`);
      }else stop();
    }
    function cancel() { if (drag.current) { stop(); setAnnouncement('Перемещение отменено'); } }
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault(); event.stopImmediatePropagation(); cancel();
      }
    }
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      drag.current?.lift?.dispose();landing.current?.();
    };
  }, []);

  function start(event: ReactPointerEvent<HTMLButtonElement>, task: Task) {
    if (readOnly || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); event.stopPropagation();
    landing.current?.();landing.current=null;
    document.dispatchEvent(new CustomEvent('task-swipe-open',{detail:null}));
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: task.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, active: false, handle: event.currentTarget };
  }

  function keyMove(event: ReactKeyboardEvent, id: string) {
    if(readOnly)return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const index = activeTasks.findIndex(task => task.id === id);
    const next = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (next < 0 || next >= activeTasks.length) return;
    const before=root.current?captureTaskLayout(root.current):new Map();
    flushSync(()=>onChange([...reorderTasks(activeTasks, id, next), ...completedTasks]));
    landing.current?.();landing.current=animateTaskLayout(before);
    setAnnouncement(`Задача перемещена на позицию ${next + 1}`);
  }

  function commitTaskSplit(result:ReturnType<typeof splitTask>){
    if(readOnly)return;
    if(!result){setAnnouncement('В облаке может быть не более 500 пунктов.');return;}
    // Commit and focus during the keyboard event: deferred focus loses the iOS keyboard.
    flushSync(()=>current.current.onChange(result.tasks));
    const row=Array.from(root.current?.querySelectorAll<HTMLElement>('[data-editor-task-id]')??[])
      .find(item=>item.dataset.editorTaskId===result.focusId);
    const input=row?.querySelector<HTMLTextAreaElement>('textarea');
    input?.focus();input?.setSelectionRange(result.focusOffset,result.focusOffset);
  }
  function breakTask(taskId:string,edit:TaskBreak){
    if(readOnly)return;
    commitTaskSplit(splitTask(current.current.tasks,taskId,edit,()=>crypto.randomUUID()));
  }
  function splitInputLines(taskId:string,value:string,caret:number){
    if(readOnly)return;
    commitTaskSplit(splitTaskLines(current.current.tasks,taskId,value,caret,()=>crypto.randomUUID()));
  }

  function renderTask(task: Task) {
    const index = tasks.findIndex(item => item.id === task.id);
    return <SwipeTask key={task.id} label={task.text} pinned={task.pinned} focused={focusMode} disabled={readOnly}
      onPin={()=>onChange(tasks.map(item=>item.id===task.id?{...item,pinned:!item.pinned}:item))}
      onCloud={()=>onMoveToCloud(task.id)} onMore={()=>onMore(task.id)} onFocus={()=>onToggleFocus?.(task.id)}>
      <div data-editor-task-id={task.id}
        className={'editor-task' + (task.done ? ' done' : '')}>
        {!readOnly&&!task.done&&<button type="button" className="editor-task-grip drag-handle" aria-label={'Переместить задачу ' + (task.text || String(index + 1))}
          aria-describedby="editor-reorder-instructions" title="Перетащить задачу. С клавиатуры: ↑ и ↓"
          onPointerDown={event => start(event, task)} onKeyDown={event => keyMove(event, task.id)}>
          <GripVertical size={19}/>
        </button>}
        <TaskCheckbox disabled={readOnly} done={task.done} focused={task.focused} label={(task.done ? 'Вернуть в активные ' : 'Выполнить ') + task.text}
          onToggleDone={() => { motion.prepare(task.id, !task.done); onChange(tasks.map(item => item.id === task.id ? { ...item, done: !item.done } : item)); }}/>
        <div className="editor-task-content">
        <TaskInput readOnly={readOnly} aria-label={'Задача ' + (index + 1)} value={task.text}
          onChange={event => onChange(tasks.map(item => item.id === task.id ? { ...item, text: event.target.value } : item),'task:'+task.id)}
          onTaskBreak={edit=>breakTask(task.id,edit)}
          onTaskLines={(value,caret)=>splitInputLines(task.id,value,caret)}/>
        <TaskMarkers task={task} hasFiles={!!filesOn?.has(task.id)} cloud={task.focused && task.origin ? (getSourceTitle?.(task) || task.origin.title) : undefined}/>
        <TaskDetails task={task} parentTitle={getParentTitle?.(task)}/>
        </div>
      </div></SwipeTask>;
  }
  return <div ref={motion.container} className="editor-task-list">
    <div ref={root} className="editor-tasks sortable-tasks">
      {activeTasks.map(renderTask)}
    </div>
    {completedTasks.length > 0 && <section className="editor-completed">
      <button type="button" className="editor-completed-toggle" aria-expanded={showCompleted} onClick={() => setShowCompleted(value => !value)}>
        <ChevronRight size={18} style={{ transform: showCompleted ? 'rotate(90deg)' : undefined }}/>
        Выполнено: {completedTasks.length}
      </button>
      {showCompleted && <div className="editor-tasks">{completedTasks.map(renderTask)}</div>}
    </section>}
    <span id="editor-reorder-instructions" className="sr-only">Перетащите задачу за точки мышью или пальцем. Для перемещения с клавиатуры нажимайте стрелки вверх и вниз. Escape отменяет перетаскивание.</span>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </div>;
}
