import YAML from "yaml";
import { normalizeStatus, TaskStatus } from "@fjg/task-core";

export const DEFAULT_GMAIL_TASK_INTAKE_ROOT = "AI Team/Mira Emails";
export const GMAIL_TASK_INTAKE_VERSION = 1;

export interface GmailTaskIntake {
  messageId: string;
  taskId: string;
  requestId: string;
  title: string;
  status: TaskStatus;
  emailSubject: string;
  emailDate: string;
  importedTaskId: string;
  attachmentPath: string;
}

interface GmailTaskIntakeFrontmatter {
  fjg_task_intake_version?: unknown;
  gmail_message_id?: unknown;
  email_subject?: unknown;
  email_date?: unknown;
  task_title?: unknown;
  task_status?: unknown;
  fjg_task_manager_task_id?: unknown;
  fjg_task_manager_imported_at?: unknown;
  fjg_task_manager_attachment_path?: unknown;
  [key: string]: unknown;
}

export function parseGmailTaskIntake(markdown: string): GmailTaskIntake | null {
  const document = parseFrontmatter(markdown);
  if (!document) return null;
  const data = document.data;
  if (Number(data.fjg_task_intake_version) !== GMAIL_TASK_INTAKE_VERSION) return null;

  const messageId = cleanInline(data.gmail_message_id);
  const title = cleanInline(data.task_title);
  const emailSubject = cleanInline(data.email_subject);
  const emailDate = cleanInline(data.email_date);
  const rawStatus = cleanInline(data.task_status);
  if (!messageId || !title || !emailSubject || !emailDate || !rawStatus) {
    throw new Error("Gmail task intake metadata is incomplete.");
  }
  if (Number.isNaN(Date.parse(emailDate))) {
    throw new Error("Gmail task intake has an invalid email date.");
  }

  const status = normalizeStatus(rawStatus);
  if (status !== rawStatus) {
    throw new Error(`Gmail task intake status is not canonical: ${rawStatus}`);
  }

  const cleanMessageId = messageId.replace(/[^A-Za-z0-9_-]/g, "");
  if (!cleanMessageId) throw new Error("Gmail task intake message ID is invalid.");

  return {
    messageId,
    taskId: `tsk_gmail_${cleanMessageId}`,
    requestId: `gmail_${cleanMessageId}`,
    title,
    status,
    emailSubject,
    emailDate: new Date(emailDate).toISOString(),
    importedTaskId: cleanInline(data.fjg_task_manager_task_id),
    attachmentPath: cleanInline(data.fjg_task_manager_attachment_path)
  };
}

export function markGmailTaskIntakeImported(
  markdown: string,
  result: {
    taskId: string;
    attachmentPath: string;
    importedAt?: string;
  }
): string {
  const document = parseFrontmatter(markdown);
  if (!document || Number(document.data.fjg_task_intake_version) !== GMAIL_TASK_INTAKE_VERSION) {
    throw new Error("Cannot mark a file that is not an FJG Gmail task intake.");
  }
  const taskId = cleanInline(result.taskId);
  const attachmentPath = cleanInline(result.attachmentPath);
  if (!taskId || !attachmentPath) {
    throw new Error("Gmail task intake import metadata is incomplete.");
  }
  document.data.fjg_task_manager_task_id = taskId;
  document.data.fjg_task_manager_imported_at = new Date(result.importedAt || Date.now()).toISOString();
  document.data.fjg_task_manager_attachment_path = attachmentPath;
  const frontmatter = YAML.stringify(document.data, { lineWidth: 0 }).trimEnd();
  return `---\n${frontmatter}\n---\n${document.body}`;
}

function parseFrontmatter(markdown: string): { data: GmailTaskIntakeFrontmatter; body: string } | null {
  const match = String(markdown || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  const parsed = YAML.parse(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Gmail task intake frontmatter must be an object.");
  }
  return {
    data: parsed as GmailTaskIntakeFrontmatter,
    body: markdown.slice(match[0].length)
  };
}

function cleanInline(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
