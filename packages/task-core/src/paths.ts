import { normalizeTaskId } from "./ids";

export const DEFAULT_ACTIVE_ROOT = "08 Tasks/Workspaces";
export const DEFAULT_ARCHIVE_ROOT = "08 Tasks/Archive";

export function sanitizeTitleForPath(value: string): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Untitled task";
}

export function normalizeVaultPath(value: string): string {
  const parts = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Invalid vault-relative path.");
  }
  return parts.join("/");
}

export function taskFolderName(taskId: string, title: string): string {
  return `${normalizeTaskId(taskId)} - ${sanitizeTitleForPath(title)}`;
}

export function taskFolderPath(root: string, taskId: string, title: string): string {
  return `${normalizeVaultPath(root)}/${taskFolderName(taskId, title)}`;
}

export function taskFilePath(folder: string): string {
  return `${normalizeVaultPath(folder)}/task.md`;
}

export function updatesFilePath(folder: string): string {
  return `${normalizeVaultPath(folder)}/updates.md`;
}
