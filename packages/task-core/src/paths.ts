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
  void taskId;
  return sanitizeTitleForPath(title);
}

export function numberedTaskFolderName(taskId: string, title: string, copyNumber = 1): string {
  const base = taskFolderName(taskId, title);
  if (copyNumber <= 1) return base;
  const suffix = ` (${copyNumber})`;
  return `${base.slice(0, Math.max(1, 120 - suffix.length)).trim()}${suffix}`;
}

export function legacyTaskFolderName(taskId: string, title: string): string {
  return `${normalizeTaskId(taskId)} - ${sanitizeTitleForPath(title)}`;
}

export function taskFolderPath(root: string, taskId: string, title: string, copyNumber = 1): string {
  return `${normalizeVaultPath(root)}/${numberedTaskFolderName(taskId, title, copyNumber)}`;
}

export function taskFilePath(folder: string): string {
  return `${normalizeVaultPath(folder)}/task.md`;
}

export function updatesFilePath(folder: string): string {
  return `${normalizeVaultPath(folder)}/updates.md`;
}
