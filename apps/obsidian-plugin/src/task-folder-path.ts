export function taskFolderClipboardPath(folderPath: string, desktopBasePath = ""): string {
  const relative = String(folderPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  const base = String(desktopBasePath || "").trim();
  if (!base) return relative;

  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const cleanBase = base.replace(/[\\/]+$/g, "");
  return `${cleanBase}${separator}${relative.replace(/\//g, separator)}`;
}
