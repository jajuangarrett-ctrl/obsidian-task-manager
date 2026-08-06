import { TASK_STATUSES, TaskStatus } from "./types";

const STATUS_ALIASES: Record<string, TaskStatus> = {
  inbox: "inbox",
  dofirst: "do-first",
  "do-first": "do-first",
  first: "do-first",
  dosoon: "do-soon",
  "do-soon": "do-soon",
  soon: "do-soon",
  next: "do-soon",
  active: "do-soon",
  "in-progress": "do-soon",
  ongoing: "ongoing",
  delegate: "delegate",
  delegated: "delegate",
  waiting: "waiting",
  wait: "waiting",
  onhold: "on-hold",
  "on-hold": "on-hold",
  hold: "on-hold",
  paused: "on-hold",
  completed: "completed",
  complete: "completed",
  done: "completed",
  archived: "archived",
  archive: "archived",
  cancelled: "archived",
  canceled: "archived"
};

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  inbox: ["do-first", "do-soon", "ongoing", "delegate", "waiting", "on-hold", "completed", "archived"],
  "do-first": ["inbox", "do-soon", "ongoing", "delegate", "waiting", "on-hold", "completed", "archived"],
  "do-soon": ["inbox", "do-first", "ongoing", "delegate", "waiting", "on-hold", "completed", "archived"],
  ongoing: ["inbox", "do-first", "do-soon", "delegate", "waiting", "on-hold", "completed", "archived"],
  delegate: ["inbox", "do-first", "do-soon", "ongoing", "waiting", "on-hold", "completed", "archived"],
  waiting: ["inbox", "do-first", "do-soon", "ongoing", "delegate", "on-hold", "completed", "archived"],
  "on-hold": ["inbox", "do-first", "do-soon", "ongoing", "delegate", "waiting", "completed", "archived"],
  completed: ["inbox", "do-first", "do-soon", "ongoing", "delegate", "waiting", "on-hold", "archived"],
  archived: ["inbox", "do-first", "do-soon", "ongoing", "delegate", "waiting", "on-hold"]
};

export function normalizeStatus(value: unknown, fallback: TaskStatus = "inbox"): TaskStatus {
  return recognizedStatus(value) ?? fallback;
}

export function isRecognizedTaskStatus(value: unknown): boolean {
  return recognizedStatus(value) !== null;
}

function recognizedStatus(value: unknown): TaskStatus | null {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return STATUS_ALIASES[key] ?? STATUS_ALIASES[key.replace(/-/g, "")] ?? null;
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus);
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Task status cannot change from ${from} to ${to}.`);
  }
}

export function statusLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    inbox: "Inbox",
    "do-first": "Do First",
    "do-soon": "Do Soon",
    ongoing: "Ongoing",
    delegate: "Delegate",
    waiting: "Waiting",
    "on-hold": "On Hold",
    completed: "Completed",
    archived: "Archived"
  };
  return labels[status];
}
