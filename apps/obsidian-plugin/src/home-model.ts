import type { TaskRecord, TaskStatus } from "@fjg/task-core";
import type { IndexedTask } from "./workspace-service";

export type HomeScope = "open" | "completed" | "archived" | "all";
export type HomeSort = "updated" | "due";
export function matchesHomeScope(record: TaskRecord, scope: HomeScope): boolean {
  return scope === "all" || (scope === "open" ? !["completed", "archived"].includes(record.status) : record.status === scope);
}
export function filterHomeTasks(tasks: readonly IndexedTask[], scope: HomeScope, query: string, project: string, status: string, sort: HomeSort): IndexedTask[] {
  const search = query.trim().toLocaleLowerCase();
  return tasks.filter(task => matchesHomeScope(task.record, scope)
    && (project === "" || (project === "__none__" ? !task.record.project : task.record.project === project))
    && (status === "" || task.record.status === status)
    && (!search || [task.record.title, task.record.task_id, task.record.project, task.taskFile.path, ...task.record.subtasks.map(sub => sub.title)].join(" ").toLocaleLowerCase().includes(search)))
    .sort((a,b) => (sort === "due" ? (a.record.due || "9999").localeCompare(b.record.due || "9999") : 0)
      || (Date.parse(b.record.updated_at) || b.taskFile.stat.mtime) - (Date.parse(a.record.updated_at) || a.taskFile.stat.mtime)
      || a.record.title.localeCompare(b.record.title) || a.record.task_id.localeCompare(b.record.task_id));
}
export function inOriginalRoot(path: string, roots: readonly string[]): boolean {
  return roots.some(root => { const clean = root.replace(/\/+$/, ""); return !!clean && path.startsWith(`${clean}/`); });
}
export function eligibleForMove(task: Pick<IndexedTask, "archived" | "relocatedBundle" | "taskFile" | "record">, roots: readonly string[]): boolean {
  return !task.archived && task.record.status !== "archived" && !task.relocatedBundle && inOriginalRoot(task.taskFile.path, roots);
}
export function nextObjectiveAction(record: Pick<TaskRecord,"subtasks">): string {
  return record.subtasks.find(sub => !sub.completed && sub.status !== "archived")?.title || "Choose your next action";
}
export function homeRowStatuses(scope: HomeScope): TaskStatus[] {
  return scope === "completed" ? ["completed"] : scope === "archived" ? ["archived"]
    : ["do-first", "do-soon", "ongoing", "waiting", "delegate", "inbox", "on-hold", ...(scope === "all" ? ["completed", "archived"] as TaskStatus[] : [])];
}
