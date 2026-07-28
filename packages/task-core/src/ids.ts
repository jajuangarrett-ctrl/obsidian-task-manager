import { ulid } from "ulid";

export function createTaskId(): string {
  return `tsk_${ulid().toLowerCase()}`;
}

export function createUpdateId(): string {
  return `upd_${ulid().toLowerCase()}`;
}

export function createRequestId(): string {
  return `req_${ulid().toLowerCase()}`;
}

export function normalizeTaskId(value: string): string {
  const clean = String(value || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
  if (!clean) throw new Error("Task ID is required.");
  return clean;
}
