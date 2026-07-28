export type RelatedFileKind = "note" | "image" | "pdf" | "document" | "file";

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const DOCUMENT_EXTENSIONS = new Set([
  "csv",
  "doc",
  "docx",
  "key",
  "numbers",
  "pages",
  "ppt",
  "pptx",
  "rtf",
  "txt",
  "xls",
  "xlsx"
]);

export function relatedFileKind(extension: string): RelatedFileKind {
  const clean = extension.toLowerCase().replace(/^\./, "");
  if (clean === "md") return "note";
  if (IMAGE_EXTENSIONS.has(clean)) return "image";
  if (clean === "pdf") return "pdf";
  if (DOCUMENT_EXTENSIONS.has(clean)) return "document";
  return "file";
}

export function isCanonicalTaskFile(name: string): boolean {
  const clean = name.toLowerCase();
  return clean === "task.md" || clean === "updates.md";
}

export function markdownPreview(markdown: string, limit = 180): string {
  const withoutFrontmatter = markdown.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "");
  const plain = withoutFrontmatter
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/\[\[([^|\]]+)(?:\|([^\]]+))?]]/g, (_match, target, alias) => alias || target)
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[>*+-]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= limit) return plain;
  return `${plain.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function safeRelatedFileName(name: string, fallback = "Untitled"): string {
  const clean = name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim();
  return clean || fallback;
}
