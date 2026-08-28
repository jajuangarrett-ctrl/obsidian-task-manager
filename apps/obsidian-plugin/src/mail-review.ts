import type { TaskSource, TaskStatus } from "@fjg/task-core";
import { CAPTURE_STATUSES, type TaskCaptureDraft } from "./quick-capture-model";

const MAX_ENCODED_PAYLOAD_LENGTH = 60_000;
const MAX_TITLE_LENGTH = 240;
const MAX_DETAILS_LENGTH = 6_000;

interface RawMailTaskPayload {
  version?: unknown;
  action?: unknown;
  title?: unknown;
  details?: unknown;
  status?: unknown;
  project?: unknown;
  due?: unknown;
  delegated_to?: unknown;
  source?: unknown;
}

export function parseMailTaskReviewPayload(
  encoded: string,
  projectNames: readonly string[]
): TaskCaptureDraft {
  if (!encoded) throw new Error("No Mail task draft was provided.");
  if (encoded.length > MAX_ENCODED_PAYLOAD_LENGTH) {
    throw new Error("The Mail task draft is too large.");
  }
  const value = decodePayload(encoded);
  if (value.version !== 1 || value.action !== "review-task") {
    throw new Error("Unsupported Mail task draft.");
  }

  const details = cleanMultiline(value.details).slice(0, MAX_DETAILS_LENGTH);
  const title = cleanInline(value.title).slice(0, MAX_TITLE_LENGTH);
  if (!title || !details) throw new Error("The Mail task draft is missing its title or details.");

  const status = cleanInline(value.status) as TaskStatus;
  const project = matchProject(value.project, projectNames);
  return {
    title,
    details,
    status: CAPTURE_STATUSES.includes(status) ? status : "do-first",
    project,
    due: cleanDate(value.due),
    delegatedTo: cleanInline(value.delegated_to).slice(0, 160),
    source: cleanEmailSource(value.source)
  };
}

function decodePayload(encoded: string): RawMailTaskPayload {
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as RawMailTaskPayload;
  } catch {
    throw new Error("The Mail task draft could not be decoded.");
  }
}

function cleanEmailSource(value: unknown): TaskSource {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    type: "email",
    title: cleanInline(source.title).slice(0, 500),
    url: cleanInline(source.url).slice(0, 2_000)
  };
}

function matchProject(value: unknown, projectNames: readonly string[]): string {
  const requested = cleanInline(value).toLocaleLowerCase();
  if (!requested) return "";
  return projectNames.find((project) => project.toLocaleLowerCase() === requested) || "";
}

function cleanDate(value: unknown): string {
  const date = cleanInline(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  return Number.isNaN(Date.parse(`${date}T00:00:00`)) ? "" : date;
}

function cleanInline(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanMultiline(value: unknown): string {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}
