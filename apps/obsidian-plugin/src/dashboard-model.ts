import { isTaskStatus, TASK_STATUSES } from "@fjg/task-core";
import type { TaskRecord, TaskStatus } from "@fjg/task-core";

export type DashboardMode = "tasks" | "kanban" | "projects";
export type TaskViewKey = "recent" | "all-open" | "due" | TaskStatus;

export const RECENT_TASK_LIMIT = 30;

export interface RecentlyModifiedTask {
  record: Pick<TaskRecord, "updated_at" | "created_at" | "task_id" | "title">;
  /** Vault file modification time, used when the task record has no usable update timestamp. */
  modifiedAt?: number;
}

export const ALL_PROJECTS = "__all_projects__";
export const NO_PROJECT = "__no_project__";

export interface TaskViewDefinition {
  key: TaskViewKey;
  label: string;
  icon: string;
}

export interface ProjectSummary {
  key: string;
  name: string;
  openCount: number;
  totalCount: number;
}

export interface KanbanTask<TRecord extends Pick<TaskRecord, "status"> = TaskRecord> {
  record: TRecord;
}

export interface KanbanColumn<TTask extends KanbanTask = KanbanTask> {
  status: TaskStatus;
  tasks: TTask[];
}

export const TASK_VIEWS: readonly TaskViewDefinition[] = [
  { key: "recent", label: "Recent Tasks", icon: "history" },
  { key: "do-first", label: "Do First", icon: "flame" },
  { key: "do-soon", label: "Do Soon", icon: "arrow-right-circle" },
  { key: "ongoing", label: "Ongoing", icon: "play-circle" },
  { key: "waiting", label: "Waiting", icon: "clock-3" },
  { key: "delegate", label: "Delegated", icon: "user-round-check" },
  { key: "inbox", label: "Inbox", icon: "inbox" },
  { key: "on-hold", label: "On Hold", icon: "pause-circle" },
  { key: "due", label: "Due or Overdue", icon: "calendar-clock" },
  { key: "all-open", label: "All Open", icon: "list-checks" },
  { key: "archived", label: "Archived", icon: "archive" }
] as const;

export function groupTasksForKanban<TTask extends KanbanTask>(tasks: readonly TTask[]): KanbanColumn<TTask>[] {
  return TASK_STATUSES.map((status) => ({
    status,
    tasks: tasks.filter((task) => task.record.status === status)
  }));
}

export function kanbanMoveTarget(current: TaskStatus, target: unknown): TaskStatus | null {
  return isTaskStatus(target) && target !== current ? target : null;
}

export function isOpenTask(record: TaskRecord): boolean {
  return record.status !== "completed" && record.status !== "archived";
}

export function isDueOrOverdue(record: TaskRecord, today = todayKey()): boolean {
  return Boolean(record.due) && isOpenTask(record) && record.due <= today;
}

export function taskMatchesView(
  record: TaskRecord,
  view: TaskViewKey,
  today = todayKey(),
  statusAssigned = true
): boolean {
  if (view === "recent") return true;
  if (view === "all-open") return isOpenTask(record);
  if (view === "due") return isDueOrOverdue(record, today);
  if (view === "inbox") return statusAssigned && record.status === "inbox";
  return record.status === view;
}

/**
 * Returns the newest task records first. Task metadata is authoritative; the
 * canonical task file's mtime keeps older or imported records discoverable.
 */
export function mostRecentlyModifiedTasks<T extends RecentlyModifiedTask>(
  tasks: readonly T[],
  limit = RECENT_TASK_LIMIT
): T[] {
  return [...tasks]
    .sort((left, right) => {
      const timestampCompare = taskModifiedAt(right) - taskModifiedAt(left);
      return timestampCompare
        || left.record.title.localeCompare(right.record.title)
        || left.record.task_id.localeCompare(right.record.task_id);
    })
    .slice(0, limit);
}

function taskModifiedAt(task: RecentlyModifiedTask): number {
  const updatedAt = Date.parse(task.record.updated_at);
  if (!Number.isNaN(updatedAt)) return updatedAt;
  if (typeof task.modifiedAt === "number" && Number.isFinite(task.modifiedAt)) return task.modifiedAt;
  const createdAt = Date.parse(task.record.created_at);
  return Number.isNaN(createdAt) ? 0 : createdAt;
}

export function countTasksForView(records: readonly TaskRecord[], view: TaskViewKey, today = todayKey()): number {
  return records.filter((record) => taskMatchesView(record, view, today)).length;
}

export function summarizeProjects(
  records: readonly TaskRecord[],
  registeredProjects: readonly string[] = []
): ProjectSummary[] {
  const summaries = new Map<string, ProjectSummary>();
  for (const project of registeredProjects) {
    const name = project.trim();
    if (!name || summaries.has(name)) continue;
    summaries.set(name, {
      key: name,
      name,
      openCount: 0,
      totalCount: 0
    });
  }
  for (const record of records) {
    if (record.status === "archived") continue;
    const project = record.project.trim();
    const key = project || NO_PROJECT;
    const current = summaries.get(key) ?? {
      key,
      name: project || "No project",
      openCount: 0,
      totalCount: 0
    };
    current.totalCount += 1;
    if (isOpenTask(record)) current.openCount += 1;
    summaries.set(key, current);
  }
  return [...summaries.values()].sort((left, right) => {
    if (left.key === NO_PROJECT) return 1;
    if (right.key === NO_PROJECT) return -1;
    return left.name.localeCompare(right.name);
  });
}

export function matchesProject(record: TaskRecord, projectKey: string): boolean {
  if (projectKey === ALL_PROJECTS) return true;
  if (projectKey === NO_PROJECT) return !record.project.trim();
  return record.project === projectKey;
}

export function canArchiveProject(summary: ProjectSummary): boolean {
  return summary.key !== NO_PROJECT && summary.openCount === 0;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
