import { statusLabel } from "@fjg/task-core";
import type { QueryableProject, QueryableTask } from "./task-query";

export const TASK_BRIEFING_FILE_NAME = "Task Manager Briefing.md";
export const TASK_BRIEFING_TYPE = "fjg-task-manager-briefing";
const RECENT_UPDATE_LIMIT = 5;

export function renderTaskManagerBriefing(
  tasks: QueryableTask[],
  projects: QueryableProject[],
  generatedAt = new Date()
): string {
  const projectGroups = buildProjectGroups(tasks, projects);
  const lines = [
    "---",
    `type: ${TASK_BRIEFING_TYPE}`,
    `generated_at: ${generatedAt.toISOString()}`,
    `task_count: ${tasks.length}`,
    `project_count: ${projects.length}`,
    "---",
    "# Task Manager Briefing",
    "",
    "> Generated from the authoritative FJG Task Manager index. Use the Task Manager dashboard's **Refresh** or **Open Task Briefing** button to regenerate this note.",
    "",
    "## Summary",
    "",
    `- Tasks represented in the dashboard: **${tasks.length}**`,
    `- Registered projects represented in the dashboard: **${projects.length}**`,
    `- Generated: ${generatedAt.toLocaleString()}`,
    "",
    "## Tasks and projects",
    ""
  ];

  if (!tasks.length && !projects.length) {
    lines.push("No tasks or projects are currently indexed by FJG Task Manager.", "");
    return `${lines.join("\n").trimEnd()}\n`;
  }

  for (const group of projectGroups) {
    lines.push(`### ${headingText(group.name)}`, "");
    if (group.project) {
      lines.push(`- Project status: **${group.project.status === "archived" ? "Archived" : "Active"}**`);
      if (group.project.path) lines.push(`- Project note: ${wikiLink(group.project.path, group.project.name)}`);
      if (group.project.notes.trim()) {
        lines.push("", "#### Project notes", "", blockquote(group.project.notes), "");
      } else {
        lines.push("");
      }
    } else if (group.name === "No project") {
      lines.push("Tasks in this section are not assigned to a project.", "");
    } else {
      lines.push("This project name is present on task records but has no registered project note.", "");
    }

    if (!group.tasks.length) {
      lines.push("_No tasks are currently assigned to this project._", "");
      continue;
    }

    for (const task of group.tasks) {
      lines.push(`#### ${headingText(task.record.title)}`, "");
      lines.push(`- Task: ${wikiLink(task.taskPath, task.record.title)}`);
      lines.push(`- Task ID: \`${inlineCode(task.record.task_id)}\``);
      lines.push(`- Status: **${statusLabel(task.record.status)}**`);
      lines.push(`- Priority: ${capitalize(task.record.priority)}`);
      lines.push(`- Due date: ${task.record.due || "Not set"}`);
      lines.push(`- Delegated to: ${task.record.delegated_to || "Not delegated"}`);
      lines.push(`- Project: ${task.record.project || "No Project"}`);
      lines.push(`- Updated: ${task.record.updated_at || "Unknown"}`);
      lines.push(`- Archived: ${task.archived ? "Yes" : "No"}`);
      if (task.projectPath) lines.push(`- Project note: ${wikiLink(task.projectPath, task.record.project || "Project")}`);
      if (task.updatesPath) lines.push(`- Full update history: ${wikiLink(task.updatesPath, `${task.record.title} updates`)}`);
      lines.push("", "##### Details and notes", "");
      lines.push(task.notes.trim() ? blockquote(task.notes) : "_No task details or notes._", "");
      lines.push("##### Recent update history", "");
      if (!task.updates.length) {
        lines.push("_No task updates recorded._", "");
      } else {
        for (const update of task.updates.slice(0, RECENT_UPDATE_LIMIT)) {
          const meta = [update.timestamp, update.actor, update.type].filter(Boolean).join(" · ");
          lines.push(`- **${escapeMarkdown(meta || "Update")}**`);
          lines.push(indent(update.text || "No update text."));
        }
        if (task.updates.length > RECENT_UPDATE_LIMIT) {
          lines.push(`- _${task.updates.length - RECENT_UPDATE_LIMIT} earlier updates are available in the linked update history._`);
        }
        lines.push("");
      }
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

interface ProjectGroup {
  name: string;
  project: QueryableProject | null;
  tasks: QueryableTask[];
}

function buildProjectGroups(tasks: QueryableTask[], projects: QueryableProject[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const project of projects) {
    const key = projectKey(project.name);
    if (!groups.has(key)) groups.set(key, { name: project.name, project, tasks: [] });
  }
  for (const task of tasks) {
    const name = task.record.project.trim() || "No project";
    const key = projectKey(name);
    const group = groups.get(key) || { name, project: null, tasks: [] };
    group.tasks.push(task);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      tasks: group.tasks.sort(compareTasks)
    }))
    .sort((left, right) => {
      if (left.name === "No project") return 1;
      if (right.name === "No project") return -1;
      if (left.project?.status !== right.project?.status) return left.project?.status === "active" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

function compareTasks(left: QueryableTask, right: QueryableTask): number {
  if (left.archived !== right.archived) return Number(left.archived) - Number(right.archived);
  const due = (left.record.due || "9999-12-31").localeCompare(right.record.due || "9999-12-31");
  return due || left.record.title.localeCompare(right.record.title);
}

function projectKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function wikiLink(filePath: string, label: string): string {
  const path = String(filePath || "").replace(/\.md$/i, "").replace(/\|/g, "｜");
  return path ? `[[${path}|${String(label || "Open note").replace(/\|/g, "｜")}]]` : "Path unavailable";
}

function blockquote(value: string): string {
  return String(value || "").trim().split(/\r?\n/).map((line) => `> ${line}`).join("\n");
}

function indent(value: string): string {
  return String(value || "").trim().split(/\r?\n/).map((line) => `  ${line}`).join("\n");
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

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "Normal";
}
