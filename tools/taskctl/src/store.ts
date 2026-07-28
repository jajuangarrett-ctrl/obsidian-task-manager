import fs from "node:fs/promises";
import path from "node:path";
import {
  appendUpdateMarkdown,
  createTaskRecord,
  DEFAULT_ACTIVE_ROOT,
  DEFAULT_ARCHIVE_ROOT,
  NewTaskInput,
  numberedTaskFolderName,
  parseTaskMarkdown,
  renderTaskMarkdown,
  renderUpdatesMarkdown,
  TaskRecord,
  TaskStatus,
  transitionTaskRecord,
  validateTaskRecord
} from "@fjg/task-core";

export interface DiskTask {
  record: TaskRecord;
  folderPath: string;
  taskPath: string;
  updatesPath: string;
  archived: boolean;
}

export class DiskTaskStore {
  constructor(
    readonly vaultPath: string,
    readonly activeRoot = DEFAULT_ACTIVE_ROOT,
    readonly archiveRoot = DEFAULT_ARCHIVE_ROOT
  ) {}

  async list(includeArchived = true): Promise<DiskTask[]> {
    const active = await this.scanRoot(this.activeRoot, false);
    const archived = includeArchived ? await this.scanRoot(this.archiveRoot, true) : [];
    const tasks = [...active, ...archived];
    const seen = new Set<string>();
    for (const task of tasks) {
      if (seen.has(task.record.task_id)) throw new Error(`Duplicate task ID ${task.record.task_id}.`);
      seen.add(task.record.task_id);
    }
    return tasks.sort((left, right) => left.record.title.localeCompare(right.record.title));
  }

  async get(taskId: string): Promise<DiskTask> {
    const task = (await this.list()).find((item) => item.record.task_id === taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  async create(input: NewTaskInput): Promise<DiskTask> {
    const record = createTaskRecord(input);
    const root = record.status === "archived" ? this.archiveRoot : this.activeRoot;
    const folder = await this.availableFolder(root, record);
    await fs.mkdir(path.join(folder, "attachments"), { recursive: true });
    await fs.writeFile(path.join(folder, "task.md"), renderTaskMarkdown(record, buildBody(record, input.details || "", input.outcome || "")), { flag: "wx" });
    await fs.writeFile(path.join(folder, "updates.md"), appendUpdateMarkdown(renderUpdatesMarkdown(), {
      actor: "taskctl",
      type: "created",
      text: "Task workspace created.",
      newStatus: record.status,
      createdAt: record.created_at
    }), { flag: "wx" });
    return this.get(record.task_id);
  }

  async appendUpdate(taskId: string, actor: string, text: string): Promise<void> {
    const task = await this.get(taskId);
    const current = await readOrDefault(task.updatesPath, renderUpdatesMarkdown());
    await fs.writeFile(task.updatesPath, appendUpdateMarkdown(current, { actor, text, type: "update" }));
    const document = parseTaskMarkdown(await fs.readFile(task.taskPath, "utf8"));
    document.record.updated_at = new Date().toISOString();
    await fs.writeFile(task.taskPath, renderTaskMarkdown(document.record, document.body));
  }

  async changeStatus(taskId: string, target: TaskStatus, actor: string): Promise<void> {
    const task = await this.get(taskId);
    const document = parseTaskMarkdown(await fs.readFile(task.taskPath, "utf8"));
    const next = transitionTaskRecord(document.record, target);
    const currentUpdates = await readOrDefault(task.updatesPath, renderUpdatesMarkdown());
    const nextUpdates = appendUpdateMarkdown(currentUpdates, {
      actor,
      type: target === "archived" ? "archived" : task.archived ? "reopened" : target === "completed" ? "completed" : "status-change",
      text: `Status changed from ${task.record.status} to ${target}.`,
      previousStatus: task.record.status,
      newStatus: target
    });
    await fs.writeFile(task.taskPath, renderTaskMarkdown(next, document.body));
    await fs.writeFile(task.updatesPath, nextUpdates);
    if (target === "archived" !== task.archived) {
      const root = target === "archived" ? this.archiveRoot : this.activeRoot;
      const destination = await this.availableFolder(root, next);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.rename(task.folderPath, destination);
    }
  }

  async validate(): Promise<Array<{ path: string; issues: string[] }>> {
    const results = [];
    for (const task of await this.list()) {
      const issues = validateTaskRecord(task.record).map((issue) => `${issue.field}: ${issue.message}`);
      try {
        await fs.access(task.updatesPath);
      } catch {
        issues.push("updates.md is missing.");
      }
      if (issues.length) results.push({ path: task.folderPath, issues });
    }
    return results;
  }

  private async scanRoot(root: string, archived: boolean): Promise<DiskTask[]> {
    const absolute = this.resolve(root);
    let folders: string[];
    try {
      folders = await fs.readdir(absolute);
    } catch {
      return [];
    }
    const tasks: DiskTask[] = [];
    for (const name of folders) {
      const folderPath = path.join(absolute, name);
      const taskPath = path.join(folderPath, "task.md");
      try {
        const stat = await fs.stat(folderPath);
        if (!stat.isDirectory()) continue;
        const document = parseTaskMarkdown(await fs.readFile(taskPath, "utf8"));
        tasks.push({
          record: document.record,
          folderPath,
          taskPath,
          updatesPath: path.join(folderPath, "updates.md"),
          archived
        });
      } catch {
        continue;
      }
    }
    return tasks;
  }

  private async availableFolder(root: string, record: TaskRecord): Promise<string> {
    for (let copyNumber = 1; copyNumber <= 999; copyNumber += 1) {
      const name = numberedTaskFolderName(record.task_id, record.title, copyNumber);
      const candidate = this.resolve(root, name);
      try {
        await fs.access(candidate);
      } catch {
        return candidate;
      }
    }
    throw new Error(`Could not create a unique workspace folder for ${record.title}.`);
  }

  private resolve(...parts: string[]): string {
    const resolved = path.resolve(this.vaultPath, ...parts);
    const root = `${path.resolve(this.vaultPath)}${path.sep}`;
    if (!resolved.startsWith(root) && resolved !== path.resolve(this.vaultPath)) throw new Error("Path escapes the configured vault.");
    return resolved;
  }
}

async function readOrDefault(filePath: string, fallback: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function buildBody(record: TaskRecord, details: string, outcome: string): string {
  return [
    `# ${record.title}`,
    "",
    "## Outcome",
    "",
    outcome.trim(),
    "",
    "## Details",
    "",
    details.trim(),
    "",
    "## Source",
    "",
    "",
    "## Related files",
    "",
    ""
  ].join("\n").replace(/\n{3,}/g, "\n\n");
}
