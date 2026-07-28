import type { TaskSource } from "@fjg/task-core";

export function firstMeaningfulLine(value: string): string {
  return String(value || "").split(/\r?\n/).map(cleanLine).find(Boolean) || "";
}

export function splitSelectedLines(value: string): string[] {
  return String(value || "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);
}

export function cleanEmailSubject(value: string): string {
  const clean = String(value || "")
    .replace(/^subject\s*:?\s*/i, "")
    .replace(/\s*Summarize this email\s*$/i, "")
    .replace(/\s+-\s+[^-]+?\s+-\s+Outlook$/i, "")
    .replace(/\s+-\s+(Outlook|Microsoft Outlook|Microsoft Outlook Web App|Mail)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || /^(Inbox|Mail|Outlook|Message|Reading Pane|Navigation)$/i.test(clean)) return "";
  return clean;
}

export function sourceForPage(
  context: { sourceKind: "web" | "email"; title: string; url: string },
  include: boolean
): TaskSource {
  if (!include) return { type: "manual", title: "", url: "" };
  if (context.sourceKind === "email") {
    return { type: "email", title: cleanEmailSubject(context.title), url: "" };
  }
  return { type: "web", title: context.title.trim(), url: context.url.trim() };
}

function cleanLine(value: string): string {
  return value
    .trim()
    .replace(/^[-*]\s+\[[ xX]\]\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}
