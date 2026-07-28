import fs from "node:fs/promises";
import path from "node:path";
import { parseProjectDocument, parseTaskMarkdown } from "@fjg/task-core";
import { LegacyTask, planLegacyMigration, planLegacyProjectMigration } from "./migrate";

const args = parseArgs(process.argv.slice(2));
const inputPath = required("input");
const stagingPath = required("staging");

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const input = JSON.parse(await fs.readFile(inputPath, "utf8")) as LegacyBoard | LegacyTask[];
  const board: LegacyBoard = Array.isArray(input) ? { tasks: input } : input;
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const projects = Array.isArray(board.projects) ? board.projects : [];
  const expectedTasks = planLegacyMigration(tasks).filter((item) => item.action === "import");
  const expectedProjects = planLegacyProjectMigration(projects, tasks, {
    createdAt: board.updatedAt || board.seededAt
  }).filter((item) => item.action === "import");
  const issues: string[] = [];
  let exactTaskFiles = 0;
  let exactUpdatesFiles = 0;
  let attachmentFolders = 0;
  let exactProjectFiles = 0;

  for (const item of expectedTasks) {
    const folder = resolveWithin(stagingPath, item.destination);
    if (await taskFileMatches(path.join(folder, "task.md"), item.taskMarkdown || "")) exactTaskFiles += 1;
    else issues.push(`Task record differs or is missing: ${item.destination}`);
    if (await updatesFileMatches(path.join(folder, "updates.md"), item.updatesMarkdown || "")) exactUpdatesFiles += 1;
    else issues.push(`Update log differs or is missing: ${item.destination}`);
    if (await isDirectory(path.join(folder, "attachments"))) attachmentFolders += 1;
    else issues.push(`Attachments folder is missing: ${item.destination}`);
  }

  for (const item of expectedProjects) {
    const folder = resolveWithin(stagingPath, item.destination);
    if (await projectFileMatches(path.join(folder, "project.md"), item.projectMarkdown || "")) exactProjectFiles += 1;
    else issues.push(`Project record differs or is missing: ${item.destination}`);
  }

  const actualTaskFiles = await countNamedFiles(stagingPath, "task.md");
  const actualUpdatesFiles = await countNamedFiles(stagingPath, "updates.md");
  const actualProjectFiles = await countNamedFiles(stagingPath, "project.md");
  if (actualTaskFiles !== expectedTasks.length) {
    issues.push(`Expected ${expectedTasks.length} task.md files; found ${actualTaskFiles}.`);
  }
  if (actualUpdatesFiles !== expectedTasks.length) {
    issues.push(`Expected ${expectedTasks.length} updates.md files; found ${actualUpdatesFiles}.`);
  }
  if (actualProjectFiles !== expectedProjects.length) {
    issues.push(`Expected ${expectedProjects.length} project.md files; found ${actualProjectFiles}.`);
  }

  const result = {
    ok: issues.length === 0,
    source_tasks: tasks.length,
    expected_tasks: expectedTasks.length,
    actual_task_files: actualTaskFiles,
    verified_task_files: exactTaskFiles,
    actual_update_files: actualUpdatesFiles,
    verified_update_files: exactUpdatesFiles,
    attachment_folders: attachmentFolders,
    source_managed_projects: projects.length,
    expected_projects: expectedProjects.length,
    actual_project_files: actualProjectFiles,
    verified_project_files: exactProjectFiles,
    issues
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (issues.length) process.exitCode = 1;
}

interface LegacyBoard {
  tasks?: LegacyTask[];
  projects?: unknown[];
  updatedAt?: string;
  seededAt?: string;
}

function parseArgs(values: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) result[name] = true;
    else {
      result[name] = next;
      index += 1;
    }
  }
  return result;
}

function required(name: string): string {
  const value = args[name];
  if (typeof value !== "string" || !value) {
    process.stderr.write(`Missing --${name}.\n`);
    process.exit(1);
  }
  return value;
}

function resolveWithin(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Audit path escapes staging root: ${relative}`);
  }
  return resolved;
}

async function taskFileMatches(filePath: string, expected: string): Promise<boolean> {
  try {
    const actualDocument = parseTaskMarkdown(await fs.readFile(filePath, "utf8"));
    const expectedDocument = parseTaskMarkdown(expected);
    return JSON.stringify(actualDocument) === JSON.stringify(expectedDocument);
  } catch {
    return false;
  }
}

async function projectFileMatches(filePath: string, expected: string): Promise<boolean> {
  try {
    const actualDocument = parseProjectDocument(await fs.readFile(filePath, "utf8"));
    const expectedDocument = parseProjectDocument(expected);
    return JSON.stringify(actualDocument) === JSON.stringify(expectedDocument);
  } catch {
    return false;
  }
}

async function updatesFileMatches(filePath: string, expected: string): Promise<boolean> {
  try {
    const actual = stripVaultFrontmatter(await fs.readFile(filePath, "utf8"));
    return normalizeMarkdown(actual) === normalizeMarkdown(expected);
  } catch {
    return false;
  }
}

function stripVaultFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function normalizeMarkdown(markdown: string): string {
  return String(markdown || "").replace(/\r\n/g, "\n").trimEnd();
}

async function isDirectory(folderPath: string): Promise<boolean> {
  try {
    return (await fs.stat(folderPath)).isDirectory();
  } catch {
    return false;
  }
}

async function countNamedFiles(root: string, fileName: string): Promise<number> {
  let count = 0;
  async function visit(folder: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile() && entry.name === fileName) count += 1;
    }
  }
  await visit(path.resolve(root));
  return count;
}
