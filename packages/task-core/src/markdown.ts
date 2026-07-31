import YAML from "yaml";
import { createTaskId, createUpdateId } from "./ids";
import { assertTransition, isRecognizedTaskStatus, normalizeStatus } from "./status";
import {
  NewTaskInput,
  TASK_SCHEMA_VERSION,
  TASK_STATUSES,
  TaskDocument,
  TaskRecord,
  TaskStatus,
  TaskUpdateInput,
  ValidationIssue
} from "./types";

const STATUS_TAG_KEYS = new Set([
  ...TASK_STATUSES.map((status) => status.replace(/-/g, "")),
  "dofirst",
  "dosoon",
  "onhold",
  "completed",
  "done",
  "archived",
  "cancelled",
  "canceled",
  "inbox",
  "delegate",
  "delegated",
  "waiting"
]);

export function normalizeTags(values: unknown): string[] {
  const source = Array.isArray(values) ? values : typeof values === "string" ? values.split(/[,\s]+/) : [];
  const result = ["task"];
  for (const value of source) {
    const clean = String(value || "").trim().replace(/^#/, "");
    if (!clean) continue;
    const statusKey = clean.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (STATUS_TAG_KEYS.has(statusKey)) continue;
    if (!result.some((tag) => tag.toLowerCase() === clean.toLowerCase())) result.push(clean);
  }
  return result;
}

export function createTaskRecord(input: NewTaskInput, now = new Date()): TaskRecord {
  const createdAt = input.createdAt || now.toISOString();
  const status = normalizeStatus(input.status);
  const completedAt = status === "completed" ? input.updatedAt || createdAt : "";
  const archivedAt = status === "archived" ? input.updatedAt || createdAt : "";
  return {
    schema_version: TASK_SCHEMA_VERSION,
    task_id: input.taskId || createTaskId(),
    title: cleanTitle(input.title),
    status,
    priority: input.priority || "normal",
    due: cleanDate(input.due),
    created_at: createdAt,
    updated_at: input.updatedAt || createdAt,
    completed_at: completedAt,
    archived_at: archivedAt,
    project: cleanInline(input.project),
    delegated_to: cleanInline(input.delegatedTo),
    source_type: input.source?.type || "manual",
    source_title: cleanInline(input.source?.title),
    source_url: cleanUrl(input.source?.url),
    legacy_ids: uniqueStrings(input.legacyIds),
    legacy_status: cleanInline(input.legacyStatus),
    tags: normalizeTags(input.tags)
  };
}

export function renderTaskMarkdown(record: TaskRecord, body?: string): string {
  const normalized = normalizeRecord(record);
  const frontmatter = YAML.stringify(normalized, { lineWidth: 0 }).trimEnd();
  const content = body === undefined ? defaultTaskBody(normalized) : normalizeBody(body);
  return `---\n${frontmatter}\n---\n${content}`;
}

export function parseTaskMarkdown(markdown: string): TaskDocument {
  const match = String(markdown || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error("Task file is missing YAML frontmatter.");
  const raw = YAML.parse(match[1]) as Partial<TaskRecord>;
  const record = normalizeRecord(raw as TaskRecord);
  const issues = validateTaskRecord(record);
  if (issues.length) {
    throw new Error(issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
  }
  return {
    record,
    body: normalizeBody(markdown.slice(match[0].length)),
    statusRecognized: isRecognizedTaskStatus(raw.status)
  };
}

export function validateTaskRecord(record: TaskRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (record.schema_version !== TASK_SCHEMA_VERSION) issues.push({ field: "schema_version", message: "Unsupported schema version." });
  if (!record.task_id) issues.push({ field: "task_id", message: "Task ID is required." });
  if (!record.title) issues.push({ field: "title", message: "Title is required." });
  if (!TASK_STATUSES.includes(record.status)) issues.push({ field: "status", message: "Status is not canonical." });
  if (!record.created_at || Number.isNaN(Date.parse(record.created_at))) issues.push({ field: "created_at", message: "Valid timestamp is required." });
  if (!record.updated_at || Number.isNaN(Date.parse(record.updated_at))) issues.push({ field: "updated_at", message: "Valid timestamp is required." });
  if (!record.tags.includes("task")) issues.push({ field: "tags", message: "Approved default task tag is required." });
  const statusTag = record.tags.find((tag) => STATUS_TAG_KEYS.has(tag.toLowerCase().replace(/[^a-z0-9]/g, "")));
  if (statusTag) issues.push({ field: "tags", message: `Status tag ${statusTag} is not allowed.` });
  return issues;
}

export function transitionTaskRecord(record: TaskRecord, target: string, at = new Date()): TaskRecord {
  const status = normalizeStatus(target);
  assertTransition(record.status, status);
  const timestamp = at.toISOString();
  return {
    ...record,
    status,
    updated_at: timestamp,
    completed_at: status === "completed" ? timestamp : status === record.status ? record.completed_at : "",
    archived_at: status === "archived" ? timestamp : status === record.status ? record.archived_at : "",
    tags: normalizeTags(record.tags)
  };
}

export function updateTaskFields(
  record: TaskRecord,
  patch: Partial<Pick<TaskRecord, "title" | "priority" | "due" | "project" | "delegated_to" | "tags">>,
  at = new Date()
): TaskRecord {
  return normalizeRecord({
    ...record,
    ...patch,
    title: patch.title === undefined ? record.title : cleanTitle(patch.title),
    due: patch.due === undefined ? record.due : cleanDate(patch.due),
    project: patch.project === undefined ? record.project : cleanInline(patch.project),
    delegated_to: patch.delegated_to === undefined ? record.delegated_to : cleanInline(patch.delegated_to),
    tags: patch.tags === undefined ? record.tags : normalizeTags(patch.tags),
    updated_at: at.toISOString()
  });
}

export function renderUpdatesMarkdown(): string {
  return "# Updates\n";
}

export function appendUpdateMarkdown(markdown: string, input: TaskUpdateInput): string {
  const updateId = input.updateId || createUpdateId();
  if (markdown.includes(`\`${updateId}\``)) return ensureTrailingNewline(markdown);
  if (input.requestId && markdown.includes(`Request ID: \`${input.requestId}\``)) return ensureTrailingNewline(markdown);
  const timestamp = input.createdAt || new Date().toISOString();
  const heading = formatLocalTimestamp(timestamp);
  const lines = [
    `### ${heading} — ${cleanInline(input.actor) || "Unknown"}`,
    "",
    `- Update ID: \`${updateId}\``,
    `- Type: \`${input.type || "update"}\``
  ];
  if (input.requestId) lines.push(`- Request ID: \`${input.requestId}\``);
  if (input.previousStatus || input.newStatus) {
    lines.push(`- Status: \`${input.previousStatus || "none"}\` → \`${input.newStatus || "none"}\``);
  }
  if (input.relatedFiles?.length) {
    lines.push(`- Related files: ${input.relatedFiles.map((file) => `[[${file.replace(/\.md$/i, "")}]]`).join(", ")}`);
  }
  lines.push("", String(input.text || "").trim());
  const source = renderSource(input.source);
  if (source) lines.push("", source);
  const base = String(markdown || "").trim() || "# Updates";
  return `${base}\n\n${lines.join("\n").trim()}\n`;
}

export function renderSource(source: TaskUpdateInput["source"]): string {
  if (!source) return "";
  const title = cleanInline(source.title);
  const url = cleanUrl(source.url);
  if (source.type === "email") return title ? `Email subject: ${title}` : "Email source: subject unavailable";
  if (title && url) return `Source: [${escapeLinkText(title)}](${url})`;
  if (url) return `Source: ${url}`;
  return title ? `Source: ${title}` : "";
}

function normalizeRecord(record: TaskRecord): TaskRecord {
  return {
    schema_version: TASK_SCHEMA_VERSION,
    task_id: cleanInline(record.task_id),
    title: cleanTitle(record.title),
    status: normalizeStatus(record.status),
    priority: record.priority === "low" || record.priority === "high" ? record.priority : "normal",
    due: cleanDate(record.due),
    created_at: cleanInline(record.created_at),
    updated_at: cleanInline(record.updated_at),
    completed_at: cleanInline(record.completed_at),
    archived_at: cleanInline(record.archived_at),
    project: cleanInline(record.project),
    delegated_to: cleanInline(record.delegated_to),
    source_type: record.source_type === "web" || record.source_type === "email" || record.source_type === "migration" ? record.source_type : "manual",
    source_title: cleanInline(record.source_title),
    source_url: cleanUrl(record.source_url),
    legacy_ids: uniqueStrings(record.legacy_ids),
    legacy_status: cleanInline(record.legacy_status),
    tags: normalizeTags(record.tags)
  };
}

function defaultTaskBody(record: TaskRecord): string {
  const source = renderSource({ type: record.source_type, title: record.source_title, url: record.source_url });
  const sections = [
    `# ${record.title}`,
    "",
    "## Outcome",
    "",
    "",
    "## Details",
    "",
    "",
    "## Source",
    "",
    source,
    "",
    "## Related files",
    ""
  ];
  return `${sections.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

function cleanTitle(value: unknown): string {
  const title = cleanInline(value);
  if (!title) throw new Error("Task title is required.");
  return title;
}

function cleanInline(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanDate(value: unknown): string {
  const clean = cleanInline(value);
  if (!clean) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) throw new Error(`Invalid date: ${clean}`);
  return clean;
}

function cleanUrl(value: unknown): string {
  const clean = String(value ?? "").trim();
  if (!clean) return "";
  try {
    const url = new URL(clean);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => cleanInline(value)).filter(Boolean))];
}

function normalizeBody(body: string): string {
  return `${String(body || "").replace(/^\s+/, "").replace(/\s+$/, "")}\n`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function escapeLinkText(value: string): string {
  return value.replace(/[[\]\\]/g, "\\$&");
}

function formatLocalTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
