import { Pin, Cloud, Tag, CalendarDays, CalendarClock } from 'lucide-react';
import {taskLabels,taskDueDate,type Task} from './board-model';
import {shortDueDate} from './task-due';

// Independent task fields share one compact visual row.
export function TaskMarkers({ task, cloud }: { task:Task; cloud?: string }) {
  const labels=taskLabels(task),due=taskDueDate(task),deadline=task.todoist?.deadlineDate;
  if (!task.pinned && !cloud && !labels.length && !due && !deadline) return null;
  return <div className="task-markers">
    {task.pinned && <span className="task-pin-icon" role="img" aria-label="Закреплено" title="Закреплено"><Pin size={13}/></span>}
    {cloud && <span className="task-source-cloud" data-task-dimension="cloud" aria-label={'Облако: '+cloud} title={'Облако: '+cloud}><Cloud size={14}/><span className="task-cloud-name">{cloud}</span></span>}
    {!!labels.length&&<span className="task-inline-tags" title={'Теги: '+labels.join(', ')}>{labels.map(label=><span className="task-meta-tag" data-task-dimension="tag" aria-label={'Тег: '+label} title={'Тег: '+label} key={label}><Tag size={12}/><span className="task-tag-name">{label}</span></span>)}</span>}
    {due&&<span className="task-date" aria-label={'Срок: '+shortDueDate(due)} title={'Срок: '+due}><CalendarDays size={12}/><time dateTime={due}>{shortDueDate(due)}</time></span>}
    {deadline&&<span className="task-date" aria-label={'Крайний срок: '+shortDueDate(deadline)} title={'Крайний срок: '+deadline}><CalendarClock size={12}/><time dateTime={deadline}>{shortDueDate(deadline)}</time></span>}
  </div>;
}
