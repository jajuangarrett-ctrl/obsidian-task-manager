import { parse, stringify } from "yaml";

export const PROJECT_SCHEMA_VERSION = 1;
export const PROJECT_DOCUMENT_TYPE = "fjg-task-project";
export type ProjectStatus = "active" | "archived";

export interface ProjectRecord {
  schema_version: 1;
  type: typeof PROJECT_DOCUMENT_TYPE;
  name: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  archived_at: string;
}

export interface ProjectDocument {
  record: ProjectRecord;
  body: string;
}

export function normalizeProjectName(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function createProjectRecord(name: string, createdAt = new Date().toISOString()): ProjectRecord {
  const normalized = normalizeProjectName(name);
  if (!normalized) throw new Error("Enter a project name.");
  return {
    schema_version: PROJECT_SCHEMA_VERSION,
    type: PROJECT_DOCUMENT_TYPE,
    name: normalized,
    status: "active",
    created_at: createdAt,
    updated_at: createdAt,
    archived_at: ""
  };
}

export function renderProjectMarkdown(record: ProjectRecord, description = ""): string {
  const body = [
    `# ${record.name}`,
    "",
    description.trim(),
    ""
  ].join("\n").replace(/\n{3,}/g, "\n\n");
  return renderProjectDocument(record, body);
}

export function renderProjectDocument(record: ProjectRecord, body: string): string {
  const frontmatter = stringify({
    ...record,
    project: record.name
  }, { lineWidth: 0 }).trimEnd();
  return `---\n${frontmatter}\n---\n${body.trim()}\n`;
}

export function parseProjectMarkdown(markdown: string): ProjectRecord {
  return parseProjectDocument(markdown).record;
}

export function parseProjectDocument(markdown: string): ProjectDocument {
  const match = String(markdown || "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("Project frontmatter is missing.");
  const value = parse(match[1]) as Partial<ProjectRecord> | null;
  if (!value || typeof value !== "object") throw new Error("Project frontmatter is invalid.");
  if (value.schema_version !== PROJECT_SCHEMA_VERSION) throw new Error("Unsupported project schema version.");
  if (value.type !== PROJECT_DOCUMENT_TYPE) throw new Error("File is not an FJG Task Manager project.");
  const name = normalizeProjectName(value.name);
  if (!name) throw new Error("Project name is missing.");
  const status: ProjectStatus = value.status === "archived" ? "archived" : "active";
  return {
    record: {
      schema_version: PROJECT_SCHEMA_VERSION,
      type: PROJECT_DOCUMENT_TYPE,
      name,
      status,
      created_at: String(value.created_at || ""),
      updated_at: String(value.updated_at || ""),
      archived_at: status === "archived" ? String(value.archived_at || "") : ""
    },
    body: String(markdown || "").slice(match[0].length).trim()
  };
}

export function archiveProjectRecord(record: ProjectRecord, at = new Date()): ProjectRecord {
  const timestamp = at.toISOString();
  return {
    ...record,
    status: "archived",
    updated_at: timestamp,
    archived_at: timestamp
  };
}

export function reopenProjectRecord(record: ProjectRecord, at = new Date()): ProjectRecord {
  return {
    ...record,
    status: "active",
    updated_at: at.toISOString(),
    archived_at: ""
  };
}
