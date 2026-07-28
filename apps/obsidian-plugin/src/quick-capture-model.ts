import { normalizeStatus, TaskStatus } from "@fjg/task-core";

export const CAPTURE_STATUSES: TaskStatus[] = [
  "inbox",
  "do-first",
  "do-soon",
  "delegate",
  "waiting",
  "on-hold"
];

export const MAX_CAPTURE_DRAFTS = 20;

export interface TaskCaptureDraft {
  title: string;
  details: string;
  status: TaskStatus;
  project: string;
  due: string;
  delegatedTo: string;
}

export interface TaskCaptureDraftContext {
  projects: string[];
  now: Date;
  timeZone: string;
}

export function buildTaskDraftRequest(
  rawCapture: string,
  model: string,
  context: TaskCaptureDraftContext
): Record<string, unknown> {
  const projects = normalizeProjects(context.projects);
  const localDate = formatLocalDate(context.now, context.timeZone);
  const projectInstruction = projects.length
    ? `Choose project only from this exact list, or return an empty string when none clearly matches: ${projects.join(" | ")}`
    : "No projects currently exist. Return an empty project string.";
  return {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "Convert a person's rough task capture into one or more reviewable task drafts.",
              "Identify every distinct action or commitment and return one task for each.",
              "Do not merge independent actions just because they appear in one sentence, paragraph, or voice capture.",
              "A repeated action verb, a list, or separately named recipients or programs often indicates separate tasks.",
              "If the capture contains only one action, return exactly one task.",
              "Preserve every commitment, name, number, and constraint from the capture.",
              "For each task, write a concise, action-oriented title of at most 12 words.",
              "Lightly clean each task's details without adding facts or details from a different task.",
              "Use do-first unless the wording clearly indicates another allowed status.",
              "Use delegate only when the user intends another person to do the work.",
              "Use waiting only when progress depends on an external response or event.",
              "Use on-hold only when the task is deliberately paused.",
              "Return an empty due date unless the capture explicitly states a date, deadline, or relative timing phrase.",
              "Never invent today, tomorrow, or another due date when timing is not stated.",
              "Resolve explicitly stated relative due dates using the supplied local date and timezone.",
              projectInstruction,
              "Return only the structured result."
            ].join("\n")
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              `Local date: ${localDate}`,
              `Timezone: ${context.timeZone}`,
              "",
              "Task capture:",
              rawCapture.trim()
            ].join("\n")
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "task_capture_drafts",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            tasks: {
              type: "array",
              minItems: 1,
              maxItems: MAX_CAPTURE_DRAFTS,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  details: { type: "string" },
                  status: {
                    type: "string",
                    enum: CAPTURE_STATUSES
                  },
                  project: { type: "string" },
                  due: {
                    type: "string",
                    description: "An ISO date in YYYY-MM-DD format, or an empty string."
                  },
                  delegated_to: { type: "string" }
                },
                required: [
                  "title",
                  "details",
                  "status",
                  "project",
                  "due",
                  "delegated_to"
                ]
              }
            }
          },
          required: ["tasks"]
        }
      }
    }
  };
}

export function parseTaskDraftsResponse(
  response: unknown,
  rawCapture: string,
  projects: string[]
): TaskCaptureDraft[] {
  const text = responseText(response);
  if (!text) throw new Error("OpenAI returned an empty task draft list.");
  let value: unknown;
  try {
    value = JSON.parse(stripJsonFence(text));
  } catch {
    throw new Error("OpenAI returned task drafts that could not be read.");
  }
  return normalizeTaskDrafts(value, rawCapture, projects);
}

export function normalizeTaskDrafts(
  value: unknown,
  rawCapture: string,
  projects: string[]
): TaskCaptureDraft[] {
  const candidates = isRecord(value) && Array.isArray(value.tasks)
    ? value.tasks
    : isRecord(value)
      ? [value]
      : [];
  const drafts = candidates
    .slice(0, MAX_CAPTURE_DRAFTS)
    .map((candidate) => normalizeTaskDraft(candidate, rawCapture, projects));
  return drafts.length
    ? drafts
    : [normalizeTaskDraft({}, rawCapture, projects)];
}

export function normalizeTaskDraft(
  value: unknown,
  rawCapture: string,
  projects: string[]
): TaskCaptureDraft {
  const source = isRecord(value) ? value : {};
  const status = normalizeStatus(source.status, "do-first");
  const allowedStatus = CAPTURE_STATUSES.includes(status) ? status : "do-first";
  return {
    title: cleanTitle(source.title) || fallbackTaskTitle(rawCapture),
    details: cleanMultiline(source.details) || rawCapture.trim(),
    status: allowedStatus,
    project: matchKnownProject(source.project, projects),
    due: normalizeDate(source.due),
    delegatedTo: cleanInline(source.delegated_to)
  };
}

export function responseText(response: unknown): string {
  if (!isRecord(response)) return "";
  const direct = cleanMultiline(response.output_text);
  if (direct) return direct;
  if (!Array.isArray(response.output)) return "";
  for (const item of response.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content)) continue;
      const text = cleanMultiline(content.text);
      if (text) return text;
    }
  }
  return "";
}

export function fallbackTaskTitle(rawCapture: string): string {
  const first = String(rawCapture || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  const words = first.replace(/^[-*]\s*/, "").split(/\s+/).filter(Boolean).slice(0, 12);
  return words.join(" ").replace(/[.!?;,:\s]+$/, "");
}

export function normalizeProjects(projects: string[]): string[] {
  return [...new Set(projects.map(cleanInline).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function matchKnownProject(value: unknown, projects: string[]): string {
  const requested = cleanInline(value).toLocaleLowerCase();
  if (!requested) return "";
  return normalizeProjects(projects)
    .find((project) => project.toLocaleLowerCase() === requested) || "";
}

function normalizeDate(value: unknown): string {
  const clean = cleanInline(value);
  if (!clean) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) && !Number.isNaN(Date.parse(`${clean}T00:00:00`))
    ? clean
    : "";
}

function cleanTitle(value: unknown): string {
  return cleanInline(value).replace(/^["']|["']$/g, "").split(/\s+/).slice(0, 12).join(" ");
}

function cleanInline(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanMultiline(value: unknown): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function stripJsonFence(value: string): string {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function formatLocalDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const find = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${find("year")}-${find("month")}-${find("day")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
