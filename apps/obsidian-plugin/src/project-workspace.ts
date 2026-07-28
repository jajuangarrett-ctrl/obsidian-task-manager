import { parse, stringify } from "yaml";

export const PROJECT_SCHEMA_VERSION = 1;
export const PROJECT_DOCUMENT_TYPE = "fjg-task-project";

export interface ProjectRecord {
  schema_version: 1;
  type: typeof PROJECT_DOCUMENT_TYPE;
  name: string;
  created_at: string;
  updated_at: string;
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
    created_at: createdAt,
    updated_at: createdAt
  };
}

export function renderProjectMarkdown(record: ProjectRecord, description = ""): string {
  const frontmatter = stringify(record, { lineWidth: 0 }).trimEnd();
  const body = [
    `# ${record.name}`,
    "",
    description.trim(),
    ""
  ].join("\n").replace(/\n{3,}/g, "\n\n");
  return `---\n${frontmatter}\n---\n${body}`;
}

export function parseProjectMarkdown(markdown: string): ProjectRecord {
  const match = String(markdown || "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("Project frontmatter is missing.");
  const value = parse(match[1]) as Partial<ProjectRecord> | null;
  if (!value || typeof value !== "object") throw new Error("Project frontmatter is invalid.");
  if (value.schema_version !== PROJECT_SCHEMA_VERSION) throw new Error("Unsupported project schema version.");
  if (value.type !== PROJECT_DOCUMENT_TYPE) throw new Error("File is not an FJG Task Manager project.");
  const name = normalizeProjectName(value.name);
  if (!name) throw new Error("Project name is missing.");
  return {
    schema_version: PROJECT_SCHEMA_VERSION,
    type: PROJECT_DOCUMENT_TYPE,
    name,
    created_at: String(value.created_at || ""),
    updated_at: String(value.updated_at || "")
  };
}
