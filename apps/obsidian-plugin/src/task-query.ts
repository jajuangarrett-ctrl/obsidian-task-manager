import type { TaskRecord } from "@fjg/task-core";
import type { TaskUpdatePreview } from "./update-preview";

export interface QueryableTask {
  record: TaskRecord;
  notes: string;
  updates: TaskUpdatePreview[];
  taskPath: string;
  updatesPath: string;
  projectPath: string;
  archived: boolean;
}

export interface QueryableProject {
  name: string;
  status: "active" | "archived";
  notes: string;
  path: string;
}

export interface TaskQueryItem {
  task_id: string;
  title: string;
  status: string;
  priority: string;
  due: string;
  project: string;
  delegated_to: string;
  updated_at: string;
  archived: boolean;
  notes: string;
  update_count: number;
  updates: TaskUpdatePreview[];
  links: {
    task: string;
    updates: string;
    project: string;
  };
}

export interface TaskQueryProjectSummary {
  name: string;
  status: "active" | "archived";
  notes: string;
  open_tasks: number;
  completed_tasks: number;
  overdue_tasks: number;
  due_this_week: number;
  updated_this_week: number;
  statuses: Record<string, number>;
  link: string;
}

export interface TaskQueryResult {
  ok: true;
  mode: "search" | "weekly-project-status";
  question: string;
  generated_at: string;
  week?: { start: string; end: string };
  count: number;
  no_results: boolean;
  message: string;
  projects: TaskQueryProjectSummary[];
  tasks: TaskQueryItem[];
}

const CLOSED_STATUSES = new Set(["completed", "archived"]);
const STOP_WORDS = new Set([
  "a", "about", "all", "and", "are", "can", "could", "do", "for", "from", "give", "has", "have",
  "i", "in", "is", "it", "me", "my", "of", "on", "please", "project", "projects", "search", "show",
  "status", "task", "tasks", "tell", "that", "the", "their", "this", "to", "update", "updates", "what",
  "where", "which", "with"
]);

const STATUS_ALIASES: Array<{ status: string; patterns: RegExp[] }> = [
  { status: "do-first", patterns: [/\bdo first\b/, /\burgent\b/] },
  { status: "do-soon", patterns: [/\bdo soon\b/] },
  { status: "ongoing", patterns: [/\bongoing\b/, /\bin progress\b/, /\bactive\b/] },
  { status: "delegate", patterns: [/\bdelegate(?:d)?\b/] },
  { status: "waiting", patterns: [/\bwaiting\b/, /\bblocked\b/] },
  { status: "on-hold", patterns: [/\bon hold\b/, /\bpaused\b/] },
  { status: "completed", patterns: [/\bcompleted\b/, /\bfinished\b/, /\bdone\b/] },
  { status: "archived", patterns: [/\barchived\b/] },
  { status: "inbox", patterns: [/\binbox\b/] }
];

export function queryTaskContext(
  tasks: QueryableTask[],
  projects: QueryableProject[],
  question: string,
  now = new Date(),
  limit = 30
): TaskQueryResult {
  const cleanQuestion = String(question || "").trim();
  if (!cleanQuestion) throw new Error("Enter a task or project question.");
  const normalized = normalizeSearch(cleanQuestion);
  const week = localWeek(now);
  if (isWeeklyProjectQuestion(normalized)) {
    return weeklyProjectStatus(tasks, projects, cleanQuestion, now, week, limit);
  }
  return searchTasks(tasks, cleanQuestion, normalized, now, week, limit);
}

function weeklyProjectStatus(
  tasks: QueryableTask[],
  projects: QueryableProject[],
  question: string,
  now: Date,
  week: { start: string; end: string },
  limit: number
): TaskQueryResult {
  const activeTasks = tasks.filter((task) => !task.archived && task.record.status !== "archived");
  const projectMap = new Map<string, QueryableProject>();
  for (const project of projects.filter((item) => item.status === "active")) {
    projectMap.set(normalizeSearch(project.name), project);
  }
  for (const task of activeTasks) {
    const name = task.record.project.trim();
    if (name && !projectMap.has(normalizeSearch(name))) {
      projectMap.set(normalizeSearch(name), { name, status: "active", notes: "", path: "" });
    }
  }

  const summaries = [...projectMap.values()].map((project) => {
    const assigned = activeTasks.filter((task) => normalizeSearch(task.record.project) === normalizeSearch(project.name));
    const open = assigned.filter((task) => !CLOSED_STATUSES.has(task.record.status));
    const statuses = countStatuses(assigned);
    return {
      name: project.name,
      status: project.status,
      notes: excerpt(project.notes, 1200),
      open_tasks: open.length,
      completed_tasks: assigned.filter((task) => task.record.status === "completed").length,
      overdue_tasks: open.filter((task) => isOverdue(task.record.due, now)).length,
      due_this_week: open.filter((task) => isDateInRange(task.record.due, week)).length,
      updated_this_week: assigned.filter((task) => taskTouchedInRange(task, week)).length,
      statuses,
      link: project.path
    } satisfies TaskQueryProjectSummary;
  }).sort((left, right) =>
    right.overdue_tasks - left.overdue_tasks
    || right.due_this_week - left.due_this_week
    || right.updated_this_week - left.updated_this_week
    || left.name.localeCompare(right.name)
  );

  const relevant = activeTasks
    .filter((task) => !CLOSED_STATUSES.has(task.record.status))
    .filter((task) => isOverdue(task.record.due, now) || isDateInRange(task.record.due, week) || taskTouchedInRange(task, week))
    .sort((left, right) => {
      const leftDue = left.record.due || "9999-12-31";
      const rightDue = right.record.due || "9999-12-31";
      return leftDue.localeCompare(rightDue) || right.record.updated_at.localeCompare(left.record.updated_at);
    })
    .slice(0, boundedLimit(limit))
    .map(toQueryItem);

  const noResults = summaries.length === 0;
  return {
    ok: true,
    mode: "weekly-project-status",
    question,
    generated_at: now.toISOString(),
    week,
    count: relevant.length,
    no_results: noResults,
    message: noResults
      ? "No active projects were found in FJG Task Manager."
      : `Found ${summaries.length} active projects and ${relevant.length} open tasks that are overdue, due this week, or updated this week.`,
    projects: summaries,
    tasks: relevant
  };
}

function searchTasks(
  tasks: QueryableTask[],
  question: string,
  normalized: string,
  now: Date,
  week: { start: string; end: string },
  limit: number
): TaskQueryResult {
  const statuses = requestedStatuses(normalized);
  const asksOverdue = /\boverdue\b/.test(normalized);
  const asksDue = /\b(due|deadline|deadlines)\b/.test(normalized);
  const asksThisWeek = /\b(this week|weekly|week)\b/.test(normalized);
  const broadTaskQuery = /\b(all|my|open) tasks?\b/.test(normalized) || /^(tasks?|open tasks?)$/.test(normalized);
  const terms = normalized.split(" ")
    .map(stem)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term) && !isFilterTerm(term));
  const uniqueTerms = [...new Set(terms)];

  const matches = tasks.map((task) => {
    if (statuses.length && !statuses.includes(task.record.status)) return null;
    if (asksOverdue && !isOverdue(task.record.due, now)) return null;
    if (asksDue && asksThisWeek && !isDateInRange(task.record.due, week)) return null;
    if (asksDue && !asksThisWeek && !asksOverdue && !task.record.due) return null;
    if (broadTaskQuery && !statuses.length && CLOSED_STATUSES.has(task.record.status)) return null;

    const fields = {
      title: normalizeSearch(task.record.title),
      project: normalizeSearch(task.record.project),
      status: normalizeSearch(task.record.status),
      due: normalizeSearch(task.record.due),
      delegated: normalizeSearch(task.record.delegated_to),
      notes: normalizeSearch(task.notes),
      updates: normalizeSearch(task.updates.map((update) => `${update.timestamp} ${update.actor} ${update.type} ${update.text}`).join(" "))
    };
    let score = 0;
    let matchedTerms = 0;
    for (const term of uniqueTerms) {
      const locations = Object.entries(fields).filter(([, value]) => value.includes(term));
      if (!locations.length) continue;
      matchedTerms += 1;
      if (fields.title.includes(term)) score += 8;
      if (fields.project.includes(term)) score += 6;
      if (fields.status.includes(term) || fields.due.includes(term)) score += 4;
      if (fields.notes.includes(term)) score += 3;
      if (fields.updates.includes(term)) score += 3;
      if (fields.delegated.includes(term)) score += 2;
    }
    const threshold = uniqueTerms.length <= 2 ? Math.min(1, uniqueTerms.length) : Math.ceil(uniqueTerms.length * 0.6);
    const filterOnly = statuses.length > 0 || asksDue || asksOverdue || broadTaskQuery;
    if (uniqueTerms.length && matchedTerms < threshold) return null;
    if (!uniqueTerms.length && !filterOnly) return null;
    if (normalizeSearch(task.record.title) === normalized) score += 100;
    if (task.archived) score -= 1;
    return { task, score };
  }).filter((entry): entry is { task: QueryableTask; score: number } => Boolean(entry));

  const results = matches
    .sort((left, right) => right.score - left.score || right.task.record.updated_at.localeCompare(left.task.record.updated_at))
    .slice(0, boundedLimit(limit))
    .map((entry) => toQueryItem(entry.task));
  const noResults = results.length === 0;
  return {
    ok: true,
    mode: "search",
    question,
    generated_at: now.toISOString(),
    count: results.length,
    no_results: noResults,
    message: noResults
      ? `No Task Manager tasks matched "${question}".`
      : `Found ${results.length} matching Task Manager ${results.length === 1 ? "task" : "tasks"}.`,
    projects: [],
    tasks: results
  };
}

function toQueryItem(task: QueryableTask): TaskQueryItem {
  return {
    task_id: task.record.task_id,
    title: task.record.title,
    status: task.record.status,
    priority: task.record.priority,
    due: task.record.due,
    project: task.record.project,
    delegated_to: task.record.delegated_to,
    updated_at: task.record.updated_at,
    archived: task.archived,
    notes: excerpt(task.notes, 6000),
    update_count: task.updates.length,
    updates: task.updates.slice(0, 20),
    links: {
      task: task.taskPath,
      updates: task.updatesPath,
      project: task.projectPath
    }
  };
}

function requestedStatuses(query: string): string[] {
  return STATUS_ALIASES.filter((entry) => entry.patterns.some((pattern) => pattern.test(query))).map((entry) => entry.status);
}

function isFilterTerm(term: string): boolean {
  return [
    "active", "archiv", "blocked", "complet", "deadline", "delegat", "done", "due", "finish", "hold",
    "inbox", "ongo", "overdue", "progress", "soon", "urgent", "wait", "week", "weekly"
  ].includes(stem(term));
}

function isWeeklyProjectQuestion(query: string): boolean {
  return /\bprojects?\b/.test(query) && /\b(this week|weekly|week)\b/.test(query);
}

function localWeek(now: Date): { start: string; end: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: dateOnly(start), end: dateOnly(end) };
}

function taskTouchedInRange(task: QueryableTask, range: { start: string; end: string }): boolean {
  if (timestampDate(task.record.updated_at) && isDateInRange(timestampDate(task.record.updated_at), range)) return true;
  return task.updates.some((update) => isDateInRange(timestampDate(update.timestamp), range));
}

function isOverdue(due: string, now: Date): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(due) && due < dateOnly(now);
}

function isDateInRange(value: string, range: { start: string; end: string }): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= range.start && value <= range.end;
}

function timestampDate(value: string): string {
  const clean = String(value || "").trim();
  const match = clean.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return "";
  // Update headings are local wall-clock timestamps. ISO frontmatter timestamps
  // carry an offset and must be converted to the user's local calendar date.
  if (!clean.includes("T") || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(clean)) return match[1];
  const parsed = new Date(clean);
  return Number.isNaN(parsed.getTime()) ? "" : dateOnly(parsed);
}

function dateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function countStatuses(tasks: QueryableTask[]): Record<string, number> {
  return tasks.reduce<Record<string, number>>((counts, task) => {
    counts[task.record.status] = (counts[task.record.status] || 0) + 1;
    return counts;
  }, {});
}

function boundedLimit(limit: number): number {
  return Math.max(1, Math.min(Number(limit) || 30, 50));
}

function normalizeSearch(value: string): string {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stem(value: string): string {
  return value.replace(/(?:ing|ed|es|s)$/i, "");
}

function excerpt(value: string, limit: number): string {
  const clean = String(value || "").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trimEnd()}…`;
}
