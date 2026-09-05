import type { TaskRecord } from "./types";

export const PROJECT_TAG_PREFIX = "project/";

export function projectTagForName(value: unknown): string {
  const name = normalizeProjectLabel(value);
  if (!name) return "";
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return slug ? `${PROJECT_TAG_PREFIX}${slug}` : "";
}

export function isProjectTag(value: unknown): boolean {
  return String(value || "").toLocaleLowerCase().startsWith(PROJECT_TAG_PREFIX);
}

export function projectNameFromTag(value: unknown): string {
  const tag = String(value || "").trim().replace(/^#/, "");
  if (!isProjectTag(tag)) return "";
  return normalizeProjectLabel(tag.slice(PROJECT_TAG_PREFIX.length).replace(/_/g, " "));
}

export function projectNameFromTags(tags: readonly string[]): string {
  return projectNameFromTag(tags.find(isProjectTag) || "");
}

export function projectNameForTask(record: Pick<TaskRecord, "project" | "tags">): string {
  return normalizeProjectLabel(record.project) || projectNameFromTags(record.tags);
}

export function syncProjectTag(tags: readonly string[], projectName: unknown): string[] {
  const next = tags.filter((tag) => !isProjectTag(tag));
  const projectTag = projectTagForName(projectName);
  if (projectTag) next.push(projectTag);
  return next;
}

export function normalizeProjectLabel(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}
