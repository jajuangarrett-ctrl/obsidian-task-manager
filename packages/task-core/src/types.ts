export const TASK_SCHEMA_VERSION = 1 as const;

export const TASK_STATUSES = [
  "inbox",
  "do-first",
  "do-soon",
  "delegate",
  "waiting",
  "on-hold",
  "completed",
  "archived"
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = "low" | "normal" | "high";
export type SourceType = "web" | "email" | "manual" | "migration";

export interface TaskRecord {
  schema_version: typeof TASK_SCHEMA_VERSION;
  task_id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due: string;
  created_at: string;
  updated_at: string;
  completed_at: string;
  archived_at: string;
  project: string;
  delegated_to: string;
  source_type: SourceType;
  source_title: string;
  source_url: string;
  legacy_ids: string[];
  legacy_status: string;
  tags: string[];
}

export interface TaskDocument {
  record: TaskRecord;
  body: string;
}

export interface TaskSource {
  type?: SourceType;
  title?: string;
  url?: string;
}

export interface NewTaskInput {
  taskId?: string;
  title: string;
  details?: string;
  outcome?: string;
  status?: string;
  priority?: TaskPriority;
  due?: string;
  project?: string;
  delegatedTo?: string;
  source?: TaskSource;
  tags?: string[];
  legacyIds?: string[];
  legacyStatus?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type UpdateType =
  | "update"
  | "created"
  | "status-change"
  | "completed"
  | "archived"
  | "reopened"
  | "fields-changed"
  | "attachment"
  | "migration";

export interface TaskUpdateInput {
  updateId?: string;
  actor: string;
  type?: UpdateType;
  text: string;
  createdAt?: string;
  previousStatus?: TaskStatus | "";
  newStatus?: TaskStatus | "";
  relatedFiles?: string[];
  source?: TaskSource;
  requestId?: string;
}

export interface ValidationIssue {
  field: string;
  message: string;
}
