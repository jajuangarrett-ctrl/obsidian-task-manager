export function taskFolderClipboardPath(folderPath: string): string {
  return String(folderPath || "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}
