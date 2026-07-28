import { createRequestId, normalizeStatus, normalizeTags, TaskSource, TaskStatus } from "@fjg/task-core";

export const PROTOCOL_VERSION = 3 as const;

export interface CreateTaskItem {
  title: string;
  details: string;
  status: TaskStatus;
  project: string;
  tags: string[];
  source: TaskSource;
}

export interface CreateTasksPayload {
  protocol_version: typeof PROTOCOL_VERSION;
  request_id: string;
  action: "create-tasks";
  items: CreateTaskItem[];
  created_at: string;
}

export interface AppendUpdatePayload {
  protocol_version: typeof PROTOCOL_VERSION;
  request_id: string;
  action: "append-update";
  task_id: string;
  task_query?: string;
  update_text: string;
  source: TaskSource;
  created_at: string;
}

export type TaskProtocolPayload = CreateTasksPayload | AppendUpdatePayload;

export interface CatalogTask {
  task_id: string;
  title: string;
  status: TaskStatus;
  project: string;
  delegated_to: string;
  path: string;
  archived: boolean;
}

export function encodeProtocolPayload(payload: TaskProtocolPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeProtocolPayload(encoded: string): TaskProtocolPayload {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  return normalizeProtocolPayload(raw);
}

export function normalizeProtocolPayload(raw: unknown): TaskProtocolPayload {
  if (!raw || typeof raw !== "object") throw new Error("Task clipper payload is invalid.");
  const value = raw as Record<string, unknown>;
  if (value.protocol_version === PROTOCOL_VERSION) return normalizeV3(value);
  if (value.version === 2) return normalizeLegacyV2(value);
  throw new Error("Unsupported task clipper protocol version.");
}

export function createCreatePayload(
  items: Array<Partial<CreateTaskItem> & Pick<CreateTaskItem, "title" | "details">>,
  options: { requestId?: string; createdAt?: string } = {}
): CreateTasksPayload {
  if (!items.length) throw new Error("At least one task is required.");
  return {
    protocol_version: PROTOCOL_VERSION,
    request_id: options.requestId || createRequestId(),
    action: "create-tasks",
    created_at: options.createdAt || new Date().toISOString(),
    items: items.map((item) => ({
      title: clean(item.title),
      details: String(item.details || "").trim(),
      status: normalizeStatus(item.status),
      project: clean(item.project),
      tags: normalizeTags(item.tags),
      source: normalizeSource(item.source)
    }))
  };
}

export function createUpdatePayload(input: {
  taskId: string;
  taskQuery?: string;
  updateText: string;
  source?: TaskSource;
  requestId?: string;
  createdAt?: string;
}): AppendUpdatePayload {
  if (!clean(input.taskId)) throw new Error("A selected task ID is required.");
  if (!String(input.updateText || "").trim()) throw new Error("Update text is required.");
  return {
    protocol_version: PROTOCOL_VERSION,
    request_id: input.requestId || createRequestId(),
    action: "append-update",
    task_id: clean(input.taskId),
    task_query: clean(input.taskQuery),
    update_text: String(input.updateText).trim(),
    source: normalizeSource(input.source),
    created_at: input.createdAt || new Date().toISOString()
  };
}

function normalizeV3(value: Record<string, unknown>): TaskProtocolPayload {
  if (value.action === "create-tasks") {
    const items = Array.isArray(value.items) ? value.items : [];
    return createCreatePayload(items as CreateTaskItem[], {
      requestId: clean(value.request_id),
      createdAt: clean(value.created_at)
    });
  }
  if (value.action === "append-update") {
    return createUpdatePayload({
      taskId: clean(value.task_id),
      taskQuery: clean(value.task_query),
      updateText: clean(value.update_text),
      source: normalizeSource(value.source),
      requestId: clean(value.request_id),
      createdAt: clean(value.created_at)
    });
  }
  throw new Error("Unknown task clipper action.");
}

function normalizeLegacyV2(value: Record<string, unknown>): TaskProtocolPayload {
  const requestId = `req_legacy_${stableHash(JSON.stringify(value))}`;
  if (value.action === "create-task-note") {
    return createCreatePayload([
      {
        title: clean(value.title) || firstLine(value.details),
        details: clean(value.details),
        status: normalizeStatus(value.status),
        project: clean(value.project),
        tags: normalizeTags(value.tags),
        source: normalizeSource(value.source)
      }
    ], { requestId, createdAt: clean(value.createdAt) });
  }
  if (value.action === "append-update") {
    return {
      protocol_version: PROTOCOL_VERSION,
      request_id: requestId,
      action: "append-update",
      task_id: clean(value.taskId),
      task_query: clean(value.taskQuery),
      update_text: clean(value.updateText),
      source: normalizeSource(value.source),
      created_at: clean(value.createdAt) || new Date().toISOString()
    };
  }
  throw new Error("Unsupported version 2 action.");
}

function normalizeSource(value: unknown): TaskSource {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const type = source.type || source.sourceKind;
  return {
    type: type === "email" ? "email" : type === "web" ? "web" : "manual",
    title: clean(source.title),
    url: clean(source.url)
  };
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function firstLine(value: unknown): string {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "Clipped task";
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
