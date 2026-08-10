import fs from "node:fs/promises";
import path from "node:path";
import {
  parseTaskMarkdown,
  renderTaskMarkdown,
  sanitizeTitleForPath,
  taskNoteFileName
} from "@fjg/task-core";
import { appendUpdateMarkdown, renderUpdatesMarkdown } from "@fjg/task-core";

interface MoveItem {
  kind: "task" | "updates" | "file";
  from: string;
  to: string;
}

interface PlannedTask {
  taskId: string;
  title: string;
  previousProject: string;
  project: string;
  workspace: string;
  warning: string;
  taskMarkdown: string;
  updatesMarkdown: string;
  moves: MoveItem[];
}

interface MigrationPlan {
  generatedAt: string;
  vault: string;
  sourceRoot: string;
  inboxRoot: string;
  projectRoot: string;
  taskCount: number;
  inboxCount: number;
  projectCount: number;
  missingProjectCount: number;
  tasks: PlannedTask[];
}

const args = process.argv.slice(2);
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const apply = args.includes("--apply");
  const vault = absoluteArg("--vault");
  if (!vault) throw new Error("Usage: tsx scripts/migrate-project-layout.ts --vault /path/to/vault [--apply]");

  const sourceRoot = path.join(vault, "08 Tasks/Workspaces");
  const inboxRoot = path.join(vault, "08 Tasks/Inbox");
  const projectRoot = path.join(vault, "08 Tasks/Projects");
  const plan = await buildPlan(vault, sourceRoot, inboxRoot, projectRoot);

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    taskCount: plan.taskCount,
    inboxCount: plan.inboxCount,
    projectCount: plan.projectCount,
    missingProjectCount: plan.missingProjectCount,
    moveCount: plan.tasks.reduce((sum, task) => sum + task.moves.length, 0),
    missingProjects: plan.tasks.filter((task) => task.warning).map((task) => ({
      task: task.title,
      project: task.previousProject,
      action: task.warning
    }))
  }, null, 2));

  if (!apply) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const manifestDir = path.join(vault, "08 Tasks/Migration Manifests");
  await fs.mkdir(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, `project-layout-${stamp}.json`);
  await fs.writeFile(manifestPath, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });

  for (const project of await activeProjects(projectRoot)) {
    await ensureWorkspaceFolders(project.folder);
  }
  await ensureWorkspaceFolders(inboxRoot);

  for (const task of plan.tasks) {
    await ensureWorkspaceFolders(task.workspace);
    const taskMove = task.moves.find((move) => move.kind === "task");
    const updatesMove = task.moves.find((move) => move.kind === "updates");
    if (!taskMove) throw new Error(`Task move missing for ${task.taskId}.`);
    if (!updatesMove) throw new Error(`Update-log move missing for ${task.taskId}.`);
    await fs.writeFile(updatesMove.from, task.updatesMarkdown);
    for (const move of task.moves.filter((item) => item.kind !== "task")) {
      await moveFile(move.from, move.to);
    }
    await fs.writeFile(taskMove.from, task.taskMarkdown);
    await moveFile(taskMove.from, taskMove.to);
  }

  console.log(JSON.stringify({ applied: true, manifestPath, taskCount: plan.taskCount }, null, 2));
}

async function buildPlan(
  vaultPath: string,
  legacyRoot: string,
  inbox: string,
  projectsRoot: string
): Promise<MigrationPlan> {
  const projects = await activeProjects(projectsRoot);
  const migrationAt = new Date().toISOString();
  const projectsByKey = new Map(projects.map((project) => [normalizeKey(project.name), project]));
  const sourceFolders = await directories(legacyRoot);
  const occupied = new Set<string>();
  await collectExistingTaskPaths(inbox, occupied);
  for (const project of projects) await collectExistingTaskPaths(project.folder, occupied);
  const tasks: PlannedTask[] = [];

  for (const sourceFolder of sourceFolders) {
    const sourceTask = path.join(sourceFolder, "task.md");
    if (!(await exists(sourceTask))) continue;
    const document = parseTaskMarkdown(await fs.readFile(sourceTask, "utf8"));
    const previousProject = document.record.project.trim();
    const project = previousProject ? projectsByKey.get(normalizeKey(previousProject)) : undefined;
    const canonicalProject = project?.name || "";
    const workspace = project?.folder || inbox;
    const warning = previousProject && !project
      ? `Project was not registered; project property cleared and task routed to Inbox.`
      : "";
    const record = canonicalProject === document.record.project
      ? document.record
      : { ...document.record, project: canonicalProject, updated_at: migrationAt };
    const basename = await availableTaskBasename(workspace, record.title, occupied);
    const taskTarget = path.join(workspace, "Tasks", basename);
    const updatesTarget = path.join(workspace, "Updates", basename);
    occupied.add(taskTarget.toLocaleLowerCase());
    occupied.add(updatesTarget.toLocaleLowerCase());
    const moves: MoveItem[] = [{ kind: "task", from: sourceTask, to: taskTarget }];
    const sourceUpdates = path.join(sourceFolder, "updates.md");
    moves.push({ kind: "updates", from: sourceUpdates, to: updatesTarget });
    const related = await filesRecursively(sourceFolder);
    const filesFolder = path.join(workspace, "Files");
    for (const file of related) {
      if (file === sourceTask || file === sourceUpdates) continue;
      const originalName = path.basename(file);
      const preferred = `${sanitizeTitleForPath(record.title)} - ${originalName}`;
      const destination = await availableFile(filesFolder, preferred, occupied);
      occupied.add(destination.toLocaleLowerCase());
      moves.push({ kind: "file", from: file, to: destination });
    }
    let updatesMarkdown = await exists(sourceUpdates)
      ? await fs.readFile(sourceUpdates, "utf8")
      : renderUpdatesMarkdown();
    updatesMarkdown = appendUpdateMarkdown(updatesMarkdown, {
      actor: "FJG Task Manager migration",
      type: "migration",
      text: warning || `Moved into the ${canonicalProject ? `${canonicalProject} project` : "Inbox"} workspace.`,
      createdAt: migrationAt
    });
    await fs.writeFile(sourceUpdates, updatesMarkdown);
    tasks.push({
      taskId: record.task_id,
      title: record.title,
      previousProject,
      project: canonicalProject,
      workspace,
      warning,
      taskMarkdown: renderTaskMarkdown(record, document.body),
      updatesMarkdown,
      moves
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    vault: vaultPath,
    sourceRoot: legacyRoot,
    inboxRoot: inbox,
    projectRoot: projectsRoot,
    taskCount: tasks.length,
    inboxCount: tasks.filter((task) => !task.project).length,
    projectCount: tasks.filter((task) => task.project).length,
    missingProjectCount: tasks.filter((task) => task.warning).length,
    tasks
  };
}

async function activeProjects(root: string): Promise<Array<{ name: string; folder: string }>> {
  const results: Array<{ name: string; folder: string }> = [];
  for (const folder of await directories(root)) {
    const projectFile = path.join(folder, "project.md");
    if (!(await exists(projectFile))) continue;
    const markdown = await fs.readFile(projectFile, "utf8");
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const name = match?.[1].match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "") || path.basename(folder);
    results.push({ name, folder });
  }
  return results;
}

async function collectExistingTaskPaths(workspace: string, occupied: Set<string>): Promise<void> {
  for (const subfolder of ["Tasks", "Updates"]) {
    const folder = path.join(workspace, subfolder);
    for (const file of await files(folder)) occupied.add(file.toLocaleLowerCase());
  }
}

async function availableTaskBasename(workspace: string, title: string, occupied: Set<string>): Promise<string> {
  for (let copy = 1; copy <= 999; copy += 1) {
    const name = taskNoteFileName(title, copy);
    const taskPath = path.join(workspace, "Tasks", name).toLocaleLowerCase();
    const updatesPath = path.join(workspace, "Updates", name).toLocaleLowerCase();
    if (!occupied.has(taskPath) && !occupied.has(updatesPath)) return name;
  }
  throw new Error(`Could not allocate task filename for ${title}.`);
}

async function availableFile(folder: string, preferred: string, occupied: Set<string>): Promise<string> {
  const extension = path.extname(preferred);
  const stem = preferred.slice(0, preferred.length - extension.length);
  for (let copy = 1; copy <= 999; copy += 1) {
    const suffix = copy === 1 ? "" : ` (${copy})`;
    const candidate = path.join(folder, `${stem}${suffix}${extension}`);
    if (!occupied.has(candidate.toLocaleLowerCase()) && !(await exists(candidate))) return candidate;
  }
  throw new Error(`Could not allocate related file ${preferred}.`);
}

async function ensureWorkspaceFolders(workspace: string): Promise<void> {
  for (const folder of [workspace, path.join(workspace, "Tasks"), path.join(workspace, "Updates"), path.join(workspace, "Files")]) {
    await fs.mkdir(folder, { recursive: true });
  }
}

async function moveFile(from: string, to: string): Promise<void> {
  if (!(await exists(from))) throw new Error(`Migration source is missing: ${from}`);
  if (await exists(to)) throw new Error(`Migration destination already exists: ${to}`);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
}

async function directories(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

async function files(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

async function filesRecursively(root: string): Promise<string[]> {
  const results: string[] = [];
  const visit = async (folder: string): Promise<void> => {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      const item = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(item);
      else if (entry.isFile()) results.push(item);
    }
  };
  await visit(root);
  return results;
}

async function exists(item: string): Promise<boolean> {
  try {
    await fs.access(item);
    return true;
  } catch {
    return false;
  }
}

function normalizeKey(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function absoluteArg(name: string): string {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : "";
}
