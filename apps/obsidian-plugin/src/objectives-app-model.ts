import { isConvertedOriginal, statusLabel } from "@fjg/task-core";
import type { TaskStatus } from "@fjg/task-core";
import { isDueOrOverdue, isOpenTask, isUpcoming } from "./dashboard-model";
import { validDateKey } from "./dashboard-date";
import type { IndexedTask } from "./workspace-service";

export const OBJECTIVES_APP_VIEW = "fjg-objectives-app";

export const APP_QUICK_VIEWS = [
  ["overview", "Overview"],
  ["all-open", "All Open"],
  ["today", "Today"],
  ["completed", "Completed"],
] as const;

export const APP_OTHER_VIEWS = [
  ["due", "Due or Overdue"],
  ["upcoming", "Upcoming"],
  ["priority", "Priority"],
  ["inbox-folder", "Inbox folder"],
  ["converted", "Converted"],
  ["unassigned", "Unassigned status"],
  ["calendar", "Calendar"],
] as const;

export const APP_STATUS_VIEWS = ["do-first", "do-soon", "ongoing", "waiting", "delegate", "inbox", "on-hold"] as const satisfies readonly TaskStatus[];
export const APP_SECTION_STATUSES = ["inbox", "do-first", "do-soon", "ongoing", "delegate", "waiting", "on-hold", "completed"] as const satisfies readonly TaskStatus[];

export type AppSectionStatus = typeof APP_SECTION_STATUSES[number];
export type AppFocus = typeof APP_QUICK_VIEWS[number][0] | typeof APP_OTHER_VIEWS[number][0] | `status:${typeof APP_STATUS_VIEWS[number]}`;
export const APP_SCOPES: readonly (readonly [AppFocus, string])[] = [
  ...APP_QUICK_VIEWS, ...APP_OTHER_VIEWS, ...APP_STATUS_VIEWS.map(status => [`status:${status}`, statusLabel(status)] as const),
];

interface ScopeContext { today: string; inboxRoot: string; calendarDay?: string }
type AppTask = Pick<IndexedTask, "record" | "taskFile" | "archived" | "statusAssigned">;

export function isAppFocus(value: unknown): value is AppFocus {
  return APP_SCOPES.some(([key]) => key === value);
}

export function isAppSectionStatus(value: unknown): value is AppSectionStatus {
  return APP_SECTION_STATUSES.some(key => key === value);
}

/** A projection of the shared index; legacy closed records are never rewritten. */
export function appFocusIncludes(task: AppTask, focus: AppFocus, { today, inboxRoot, calendarDay }: ScopeContext): boolean {
  const { record } = task;
  const converted = isConvertedOriginal(record);
  if (focus === "converted") return converted;
  if (converted) return false;
  const legacyArchived = !!record.__fjgSourceArchived || record.status === "archived";
  if (focus === "completed") return task.statusAssigned && (record.status === "completed" || legacyArchived);
  if (task.archived || legacyArchived) return false;
  if (focus === "overview") return task.statusAssigned;
  if (focus === "unassigned") return !task.statusAssigned;
  if (focus === "inbox-folder") {
    const root = inboxRoot.replace(/\/+$/, "");
    return !!root && task.taskFile.path.startsWith(`${root}/`);
  }
  if (focus.startsWith("status:")) return task.statusAssigned && record.status === focus.slice("status:".length);
  if (focus === "due") return isDueOrOverdue(record, today);
  if (focus === "upcoming") return isUpcoming(record, today);
  if (!isOpenTask(record)) return false;
  if (focus === "today") return record.due === today;
  if (focus === "calendar") return validDateKey(record.due) && record.due === (calendarDay || today);
  if (focus === "priority") return record.priority === "high" || (task.statusAssigned && record.status === "do-first");
  return true;
}

export function appTaskMatchesSearch(task: AppTask, query: string): boolean {
  if (!query) return true;
  const { record } = task;
  const fieldText = [
    record.title, record.task_id, record.project, record.delegated_to, task.taskFile.path,
    ...(record.people ?? []), ...record.tags, ...record.subtasks.map(action => action.title),
  ].join(" ").toLocaleLowerCase();
  return query.toLocaleLowerCase().split(/\s+/).every(word => fieldText.includes(word));
}

export function appSectionGroups<T extends AppTask>(matches: readonly T[], searching: boolean): { status: AppSectionStatus; tasks: T[] }[] {
  const byStatus = new Map<TaskStatus, T[]>();
  for (const task of matches) {
    const group = byStatus.get(task.record.status);
    if (group) group.push(task);
    else byStatus.set(task.record.status, [task]);
  }
  const groups = APP_SECTION_STATUSES.map(status => ({ status, tasks: byStatus.get(status) ?? [] }));
  return searching ? groups.filter(group => group.tasks.length) : groups;
}

export function canEditAppObjective(task: AppTask): boolean {
  return !task.archived && !task.record.__fjgSourceArchived && task.record.status !== "archived" && !isConvertedOriginal(task.record);
}
