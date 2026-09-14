import { projectTagForName, statusLabel } from "@fjg/task-core";
import type { QueryableProject, QueryableTask } from "./task-query";

export const TASK_BRIEFING_FILE_NAME = "Task Manager Briefing.md";
export const TASK_BRIEFING_TYPE = "fjg-task-manager-briefing";
const RECENT_UPDATE_LIMIT = 5;

interface MarkdownSection {
  level: number;
  title: string;
  lines: string[];
  children: MarkdownSection[];
}

interface ParsedPreview {
  preamble: string[];
  sections: MarkdownSection[];
}

export function renderTaskManagerBriefing(
  tasks: QueryableTask[],
  projects: QueryableProject[],
  generatedAt = new Date()
): string {
  const includedTasks = tasks.filter((task) => !isArchived(task)).sort(compareTasks);
  const lines = [
    "---",
    `type: ${TASK_BRIEFING_TYPE}`,
    `generated_at: ${generatedAt.toISOString()}`,
    `task_count: ${includedTasks.length}`,
    `project_count: ${projects.length}`,
    "---",
    "# Objective Manager Briefing",
    "",
    "> Generated from the authoritative FJG Objective Manager index. Archived objectives are intentionally omitted. Use the Objective Manager dashboard's **Refresh** or **Open Objective Briefing** button to regenerate this note.",
    "",
    "## Summary",
    "",
    `- Objectives in this briefing: **${includedTasks.length}**`,
    `- Project tags represented in the Objective Manager: **${projects.length}**`,
    `- Generated: ${humanDateTime(generatedAt)}`,
    "",
    "## Objectives",
    ""
  ];

  if (!includedTasks.length) {
    lines.push("_No non-archived objectives are currently indexed._", "");
  } else {
    for (const task of includedTasks) lines.push(...renderObjective(task));
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function renderObjective(task: QueryableTask): string[] {
  const lines = [
    `### ${wikiLink(task.taskPath, headingText(task.record.title))}`,
    "",
    objectiveSummary(task),
    "",
    referenceLine(task),
    ""
  ];

  if (task.record.subtasks?.length) {
    lines.push("#### Actions", "");
    for (const action of task.record.subtasks) {
      const meta = [statusLabel(action.status), action.due ? `Due ${humanDate(action.due)}` : ""].filter(Boolean).join(" · ");
      lines.push(`- [${action.completed ? "x" : " "}] **${escapeMarkdown(action.title)}**${meta ? ` · ${meta}` : ""}`);
      const notes = renderCompactNotes(action.notes, action.title);
      if (notes) lines.push(indent(notes));
    }
    lines.push("");
  }

  const preview = prepareTaskPreview(task);
  if (hasMeaningfulLines(preview.preamble)) {
    lines.push("#### Notes", "", ...trimBlankLines(preview.preamble), "");
  }
  for (const section of preview.sections) {
    lines.push(...renderSection(section, 4), "");
  }

  if (task.updates.length) {
    lines.push("#### Recent updates", "");
    for (const update of task.updates.slice(0, RECENT_UPDATE_LIMIT)) {
      const meta = [humanDateTime(update.timestamp), update.actor, humanize(update.type)].filter(Boolean).join(" · ");
      lines.push(`- **${escapeMarkdown(meta || "Update")}**`);
      if (String(update.text || "").trim()) lines.push(indent(update.text));
    }
    if (task.updates.length > RECENT_UPDATE_LIMIT) {
      lines.push(`- _${task.updates.length - RECENT_UPDATE_LIMIT} earlier updates are available through the update-history link above._`);
    }
    lines.push("");
  }

  return lines;
}

function prepareTaskPreview(task: QueryableTask): ParsedPreview {
  const preview = parsePreview(task.notes, task.record.title);
  const source = sourceLine(task);
  if (source) appendUniqueSectionLine(preview.sections, "Source", source, task.record.source_url || task.record.source_title);
  for (const file of task.record.related_files || []) {
    appendUniqueSectionLine(preview.sections, "Related files", `- ${wikiLink(file, fileLabel(file))}`, file);
  }
  preview.sections = preview.sections.filter(sectionHasContent);
  return preview;
}

function objectiveSummary(task: QueryableTask): string {
  const items = [`**Status:** ${statusLabel(task.record.status)}`];
  if (task.record.due) items.push(`**Due:** ${humanDate(task.record.due)}`);
  if (task.record.project) {
    const tag = projectTagForName(task.record.project);
    items.push(`**Project:** ${tag ? `#${tag}` : escapeMarkdown(task.record.project)}`);
  }
  if (task.record.delegated_to) items.push(`**Delegated:** ${escapeMarkdown(task.record.delegated_to)}`);
  if (task.record.priority !== "normal") items.push(`**Priority:** ${capitalize(task.record.priority)}`);
  return items.join(" · ");
}

function referenceLine(task: QueryableTask): string {
  const references = [`ID: \`${inlineCode(task.record.task_id)}\``];
  if (task.record.updated_at) references.push(`Updated: ${humanDate(task.record.updated_at)}`);
  if (task.updatesPath) references.push(wikiLink(task.updatesPath, "Full update history"));
  return `_${references.join(" · ")}_`;
}

function sourceLine(task: QueryableTask): string {
  const title = task.record.source_title || (task.record.source_type !== "manual" ? `${capitalize(task.record.source_type)} source` : "");
  if (task.record.source_url) return `[${escapeLinkText(title || "Open source")}](${task.record.source_url})`;
  return title ? escapeMarkdown(title) : "";
}

function appendUniqueSectionLine(sections: MarkdownSection[], title: string, line: string, identity: string): void {
  const key = normalizeHeading(title);
  let section = sections.find((candidate) => normalizeHeading(candidate.title) === key);
  const searchable = section ? sectionText(section) : "";
  if (identity && searchable.includes(identity)) return;
  if (!section) {
    section = { level: 2, title, lines: [], children: [] };
    sections.push(section);
  }
  if (hasMeaningfulLines(section.lines)) section.lines.push("");
  section.lines.push(line);
}

function parsePreview(value: string, title: string): ParsedPreview {
  const root: MarkdownSection = { level: 0, title: "", lines: [], children: [] };
  const stack = [root];
  let fence = "";
  for (const line of String(value || "").split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = "";
    }
    const heading = !fence ? line.match(/^(#{1,6})\s+(.+?)\s*$/) : null;
    if (!heading) {
      stack[stack.length - 1].lines.push(line);
      continue;
    }
    const node: MarkdownSection = {
      level: heading[1].length,
      title: heading[2].replace(/\s+#+\s*$/, "").trim(),
      lines: [],
      children: []
    };
    while (stack.length > 1 && stack[stack.length - 1].level >= node.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  const preamble = [...root.lines];
  let sections = [...root.children];
  const wrapper = sections[0];
  if (wrapper?.level === 1 && isTaskTitleWrapper(wrapper, title, preamble)) {
    preamble.push(...wrapper.lines);
    sections = [...wrapper.children, ...sections.slice(1)];
  }
  return {
    preamble: trimBlankLines(preamble),
    sections: sections.filter(sectionHasContent)
  };
}

function isTaskTitleWrapper(section: MarkdownSection, title: string, preamble: string[]): boolean {
  if (normalizeHeading(section.title) === normalizeHeading(title)) return true;
  const standardSections = new Set(["outcome", "details", "source", "related files"]);
  return !hasMeaningfulLines(preamble) && section.children.some((child) => standardSections.has(normalizeHeading(child.title)));
}

function sectionHasContent(section: MarkdownSection): boolean {
  section.lines = trimBlankLines(section.lines);
  section.children = section.children.filter(sectionHasContent);
  return hasMeaningfulLines(section.lines) || section.children.length > 0;
}

function hasMeaningfulLines(lines: string[]): boolean {
  return lines.some((line) => {
    const clean = line.trim();
    return Boolean(clean && !/^<!--[\s\S]*-->$/.test(clean));
  });
}

function renderSection(section: MarkdownSection, level: number): string[] {
  const lines = [headingLine(section.title, level), "", ...trimBlankLines(section.lines)];
  for (const child of section.children) {
    if (hasMeaningfulLines(lines)) lines.push("");
    lines.push(...renderSection(child, level + 1));
  }
  return trimBlankLines(lines);
}

function renderCompactNotes(value: string, title: string): string {
  const preview = parsePreview(value, title);
  const lines = [...preview.preamble];
  for (const section of preview.sections) {
    if (hasMeaningfulLines(lines)) lines.push("");
    lines.push(`**${escapeMarkdown(section.title)}**`);
    if (hasMeaningfulLines(section.lines)) lines.push("", ...trimBlankLines(section.lines));
    for (const child of section.children) lines.push("", ...renderCompactSection(child));
  }
  return trimBlankLines(lines).join("\n");
}

function renderCompactSection(section: MarkdownSection): string[] {
  const lines = [`**${escapeMarkdown(section.title)}**`];
  if (hasMeaningfulLines(section.lines)) lines.push("", ...trimBlankLines(section.lines));
  for (const child of section.children) lines.push("", ...renderCompactSection(child));
  return lines;
}

function headingLine(value: string, level: number): string {
  const title = headingText(value);
  return level <= 6 ? `${"#".repeat(level)} ${title}` : `**${escapeMarkdown(title)}**`;
}

function compareTasks(left: QueryableTask, right: QueryableTask): number {
  const due = (left.record.due || "9999-12-31").localeCompare(right.record.due || "9999-12-31");
  return due || left.record.title.localeCompare(right.record.title);
}

function isArchived(task: QueryableTask): boolean {
  return task.archived || task.record.status === "archived";
}

function wikiLink(filePath: string, label: string): string {
  const path = String(filePath || "").replace(/\.md$/i, "").replace(/\|/g, "｜");
  return path ? `[[${path}|${String(label || "Open note").replace(/\|/g, "｜")}]]` : "Path unavailable";
}

function fileLabel(value: string): string {
  const parts = String(value || "").split("/");
  return parts[parts.length - 1] || "Related file";
}

function indent(value: string): string {
  return String(value || "").trim().split(/\r?\n/).map((line) => `  ${line}`).join("\n");
}

function trimBlankLines(lines: string[]): string[] {
  const result = [...lines];
  while (result[0]?.trim() === "") result.shift();
  while (result[result.length - 1]?.trim() === "") result.pop();
  return result;
}

function sectionText(section: MarkdownSection): string {
  return [section.title, ...section.lines, ...section.children.map(sectionText)].join("\n");
}

function normalizeHeading(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function headingText(value: string): string {
  return String(value || "Untitled").replace(/\s+/g, " ").replace(/#/g, "＃").trim();
}

function inlineCode(value: string): string {
  return String(value || "").replace(/`/g, "ˋ");
}

function escapeMarkdown(value: string): string {
  return String(value || "").replace(/[*_]/g, "\\$&");
}

function escapeLinkText(value: string): string {
  return String(value || "").replace(/[[\]\\]/g, "\\$&");
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "Normal";
}

function humanize(value: string): string {
  const clean = String(value || "").replace(/[-_]+/g, " ").trim();
  return clean ? `${clean[0].toUpperCase()}${clean.slice(1)}` : "";
}

function humanDate(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function humanDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return String(value || "");
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
