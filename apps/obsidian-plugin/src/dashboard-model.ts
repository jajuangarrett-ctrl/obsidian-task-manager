import type { TaskRecord, TaskStatus } from "@fjg/task-core";

export type DashboardMode = "tasks" | "projects";
export type TaskViewKey = "all-open" | "due" | Exclude<TaskStatus, "archived">;

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

export const TASK_VIEWS: readonly TaskViewDefinition[] = [
  { key: "do-first", label: "Do First", icon: "flame" },
  { key: "do-soon", label: "Do Soon", icon: "arrow-right-circle" },
  { key: "waiting", label: "Waiting", icon: "clock-3" },
  { key: "delegate", label: "Delegated", icon: "user-round-check" },
  { key: "inbox", label: "Inbox", icon: "inbox" },
  { key: "on-hold", label: "On Hold", icon: "pause-circle" },
  { key: "due", label: "Due or Overdue", icon: "calendar-clock" },
  { key: "all-open", label: "All Open", icon: "list-checks" },
  { key: "completed", label: "Completed", icon: "circle-check-big" }
] as const;

export function isOpenTask(record: TaskRecord): boolean {
  return record.status !== "completed" && record.status !== "archived";
}

export function isDueOrOverdue(record: TaskRecord, today = todayKey()): boolean {
  return Boolean(record.due) && isOpenTask(record) && record.due <= today;
}

export function taskMatchesView(record: TaskRecord, view: TaskViewKey, today = todayKey()): boolean {
  if (view === "all-open") return isOpenTask(record);
  if (view === "due") return isDueOrOverdue(record, today);
  return record.status === view;
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

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
