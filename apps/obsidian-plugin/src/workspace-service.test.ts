import { describe, expect, it, vi } from "vitest";

const obsidianMock = vi.hoisted(() => {
  function normalizePath(value: string): string {
    return String(value || "")
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/^\/+|\/+$/g, "");
  }

  class MockTFolder {
    path: string;
    name: string;
    parent: { path: string } | null;

    constructor(value: string) {
      this.path = normalizePath(value);
      this.name = this.path.split("/").pop() || "";
      const parent = this.path.includes("/") ? this.path.slice(0, this.path.lastIndexOf("/")) : "";
      this.parent = parent ? { path: parent } : null;
    }
  }

  class MockTFile {
    path: string;
    name: string;
    basename: string;
    extension: string;
    parent: { path: string } | null;
    stat: { mtime: number; size: number };
    content: string;

    constructor(value: string, content: string) {
      this.path = "";
      this.name = "";
      this.basename = "";
      this.extension = "";
      this.parent = null;
      this.stat = { mtime: Date.now(), size: content.length };
      this.content = content;
      this.setPath(value);
    }

    setPath(value: string): void {
      this.path = normalizePath(value);
      this.name = this.path.split("/").pop() || "";
      const dot = this.name.lastIndexOf(".");
      this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
      this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
      const parent = this.path.includes("/") ? this.path.slice(0, this.path.lastIndexOf("/")) : "";
      this.parent = parent ? { path: parent } : null;
    }
  }

  return { normalizePath, MockTFile, MockTFolder };
});

vi.mock("obsidian", () => ({
  App: class {},
  TAbstractFile: class {},
  TFile: obsidianMock.MockTFile,
  TFolder: obsidianMock.MockTFolder,
  normalizePath: obsidianMock.normalizePath
}));

import { TaskWorkspaceService } from "./workspace-service";
import { createTaskRecord, parseTaskMarkdown, renderTaskMarkdown, renderUpdatesMarkdown, updateTaskFields } from "@fjg/task-core";

class MockVault {
  private readonly entries = new Map<string, InstanceType<typeof obsidianMock.MockTFile> | InstanceType<typeof obsidianMock.MockTFolder>>();
  failNextRenameTarget = "";
  failNextWriteTarget = "";

  readonly adapter = {
    stat: async (value: string) => {
      const entry = this.entries.get(obsidianMock.normalizePath(value));
      if (!entry) return null;
      return { type: entry instanceof obsidianMock.MockTFolder ? "folder" : "file" };
    }
  };

  getAbstractFileByPath(value: string) {
    return this.entries.get(obsidianMock.normalizePath(value)) || null;
  }

  getMarkdownFiles() {
    return this.getFiles().filter((file) => file.extension === "md");
  }

  getFiles() {
    return [...this.entries.values()].filter((entry): entry is InstanceType<typeof obsidianMock.MockTFile> => {
      return entry instanceof obsidianMock.MockTFile;
    });
  }

  getAllLoadedFiles() {
    return [...this.entries.values()];
  }

  async createFolder(value: string) {
    const folder = new obsidianMock.MockTFolder(value);
    if (this.entries.has(folder.path)) throw new Error(`Already exists: ${folder.path}`);
    this.entries.set(folder.path, folder);
    return folder;
  }

  async create(value: string, content: string) {
    const file = new obsidianMock.MockTFile(value, content);
    if (file.path === this.failNextWriteTarget) {
      this.failNextWriteTarget = "";
      throw new Error(`Simulated write failure: ${file.path}`);
    }
    if (this.entries.has(file.path)) throw new Error(`Already exists: ${file.path}`);
    this.entries.set(file.path, file);
    return file;
  }

  async createBinary(value: string, content: ArrayBuffer) {
    return this.create(value, Buffer.from(content).toString("binary"));
  }

  async cachedRead(file: InstanceType<typeof obsidianMock.MockTFile>) {
    return file.content;
  }

  async read(file: InstanceType<typeof obsidianMock.MockTFile>) {
    return file.content;
  }

  async modify(file: InstanceType<typeof obsidianMock.MockTFile>, content: string) {
    if (file.path === this.failNextWriteTarget) {
      this.failNextWriteTarget = "";
      throw new Error(`Simulated write failure: ${file.path}`);
    }
    file.content = content;
    file.stat = { mtime: Date.now(), size: content.length };
  }

  async delete(entry: InstanceType<typeof obsidianMock.MockTFile> | InstanceType<typeof obsidianMock.MockTFolder>) {
    this.entries.delete(entry.path);
  }

  async rename(entry: InstanceType<typeof obsidianMock.MockTFolder>, target: string) {
    const oldPath = entry.path;
    const normalizedTarget = obsidianMock.normalizePath(target);
    if (normalizedTarget === this.failNextRenameTarget) {
      this.failNextRenameTarget = "";
      throw new Error(`Simulated rename failure: ${normalizedTarget}`);
    }
    if (this.entries.has(normalizedTarget)) throw new Error(`Already exists: ${normalizedTarget}`);
    const descendants = [...this.entries.entries()].filter(([key]) => key === oldPath || key.startsWith(`${oldPath}/`));
    for (const [key] of descendants) this.entries.delete(key);
    for (const [key, child] of descendants) {
      const nextPath = `${normalizedTarget}${key.slice(oldPath.length)}`;
      if (child instanceof obsidianMock.MockTFile) child.setPath(nextPath);
      else {
        child.path = nextPath;
        child.name = nextPath.split("/").pop() || "";
      }
      this.entries.set(nextPath, child);
    }
  }

  async renameFile(file: InstanceType<typeof obsidianMock.MockTFile>, target: string) {
    const oldPath = file.path;
    const nextPath = obsidianMock.normalizePath(target);
    if (nextPath === this.failNextRenameTarget) {
      this.failNextRenameTarget = "";
      throw new Error(`Simulated rename failure: ${nextPath}`);
    }
    if (this.entries.has(nextPath)) throw new Error(`Already exists: ${nextPath}`);
    this.entries.delete(oldPath);
    file.setPath(nextPath);
    this.entries.set(nextPath, file);
  }
}

function createService() {
  const vault = new MockVault();
  const app = {
    vault,
    fileManager: {
      renameFile: (file: InstanceType<typeof obsidianMock.MockTFile>, target: string) => vault.renameFile(file, target)
    }
  };
  const settings = {
    activeRoot: "08 Tasks/Workspaces",
    inboxRoot: "08 Tasks/Inbox",
    archiveRoot: "08 Tasks/Archive",
    projectRoot: "08 Tasks/Projects",
    projectArchiveRoot: "08 Tasks/Project Archive"
  };
  return {
    vault,
    service: new TaskWorkspaceService(app as never, () => settings as never)
  };
}

describe("TaskWorkspaceService project-centered moves", () => {
  it("archives a confirmed task and preserves its project tag and identity", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const task = await service.createTask({
      taskId: "tsk_confirmed_archive",
      title: "Archive after confirmation",
      status: "do-first",
      project: "Basic Needs Expansion"
    });

    const archived = await service.changeStatus(task.record.task_id, "archived");

    expect(archived).toMatchObject({
      archived: true,
      record: {
        task_id: "tsk_confirmed_archive",
        title: "Archive after confirmation",
        status: "archived",
        project: "Basic Needs Expansion"
      }
    });
    expect(archived.record.tags).toContain("project/Basic_Needs_Expansion");
    expect(archived.taskFile.path).toBe("08 Tasks/Archive/Tasks/Archive after confirmation/task.md");
    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Tasks/Archive after confirmation/task.md")).toBeNull();
  });

  it("discovers files stored in the task-specific Files folder without requiring metadata backfill", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const task = await service.createTask({
      taskId: "tsk_discover_related_files",
      title: "Review support packet",
      status: "do-first"
    });
    await vault.create(
      "08 Tasks/Inbox/Files/Review support packet/Supporting note.md",
      "# Supporting note\n\nKeep this visible on the task.\n"
    );

    await service.refresh();

    expect(service.getById(task.record.task_id).record.related_files).toEqual([]);
    expect(service.getById(task.record.task_id).relatedFiles.map((related) => related.file.path))
      .toEqual(["08 Tasks/Inbox/Files/Review support packet/Supporting note.md"]);
  });

  it("renames matching task, update, and file folders while preserving task state", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await service.createProject("Project Alpha");
    const task = await service.createTask({
      taskId: "tsk_task_rename",
      title: "Original task name",
      details: "Keep the original task details.",
      project: "Project Alpha",
      status: "waiting",
      due: "2026-09-15"
    });
    const related = await service.createRelatedNote(task.record.task_id, "Rename evidence", "Keep this file.");
    await service.appendUpdate(task.record.task_id, {
      actor: "Franklin",
      text: "Keep this update history."
    });
    const before = service.getById(task.record.task_id);
    const updatesBefore = await vault.read(before.updatesFile as never);

    const renamed = await service.renameTask(task.record.task_id, "Renamed task name");

    expect(renamed).toMatchObject({
      record: {
        task_id: task.record.task_id,
        title: "Renamed task name",
        location: "08 Tasks/Inbox/Tasks/Renamed task name",
        project: "Project Alpha",
        status: "waiting",
        due: "2026-09-15"
      },
      folderPath: "08 Tasks/Inbox"
    });
    expect(renamed.taskFile.path)
      .toBe("08 Tasks/Inbox/Tasks/Renamed task name/task.md");
    expect(renamed.updatesFile?.path)
      .toBe("08 Tasks/Inbox/Updates/Renamed task name/updates.md");
    expect(renamed.record.related_files)
      .toEqual(["08 Tasks/Inbox/Files/Renamed task name/Rename evidence.md"]);
    expect(vault.getAbstractFileByPath(related.path.replace("Original task name", "Renamed task name"))).not.toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Tasks/Original task name")).toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Updates/Original task name")).toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Files/Original task name")).toBeNull();
    expect(await vault.read(renamed.updatesFile as never)).toBe(updatesBefore);
    expect(await vault.read(renamed.taskFile as never)).toContain("# Renamed task name");
    expect(await vault.read(renamed.taskFile as never)).toContain("Keep the original task details.");
  });

  it("renames one relocated task directory with its update log and Files folder intact", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await vault.createFolder("03 Areas");
    await vault.createFolder("03 Areas/Career");
    const task = await service.createTask({
      taskId: "tsk_relocated_rename",
      title: "Relocated task",
      status: "do-soon"
    });
    await service.createRelatedNote(task.record.task_id, "Relocated evidence", "Keep this file.");
    const relocated = await service.relocateTask(task.record.task_id, "03 Areas/Career");
    const updatesBefore = await vault.read(relocated.updatesFile as never);

    const renamed = await service.renameTask(task.record.task_id, "Renamed relocated task");

    expect(renamed.folderPath)
      .toBe("03 Areas/Career/Career Tasks/Renamed relocated task");
    expect(renamed.taskFile.path)
      .toBe("03 Areas/Career/Career Tasks/Renamed relocated task/task.md");
    expect(renamed.updatesFile?.path)
      .toBe("03 Areas/Career/Career Tasks/Renamed relocated task/updates.md");
    expect(renamed.record.location)
      .toBe("03 Areas/Career/Career Tasks/Renamed relocated task");
    expect(renamed.record.related_files)
      .toEqual(["03 Areas/Career/Career Tasks/Renamed relocated task/Files/Relocated evidence.md"]);
    expect(vault.getAbstractFileByPath(
      "03 Areas/Career/Career Tasks/Renamed relocated task/Files/Relocated evidence.md"
    )).not.toBeNull();
    expect(await vault.read(renamed.updatesFile as never)).toBe(updatesBefore);
  });

  it("rejects empty, unsafe, too-long, same, and colliding task names before moving files", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const task = await service.createTask({ taskId: "tsk_rename_validation", title: "Alpha task" });
    await service.createTask({ taskId: "tsk_rename_collision", title: "Beta task" });
    const before = await vault.read(task.taskFile as never);

    await expect(service.renameTask(task.record.task_id, "   ")).rejects.toThrow("Enter a task name.");
    await expect(service.renameTask(task.record.task_id, "Unsafe/task")).rejects.toThrow("Task names cannot contain");
    await expect(service.renameTask(task.record.task_id, "x".repeat(121))).rejects.toThrow("120 characters or fewer");
    await expect(service.renameTask(task.record.task_id, "alpha-task")).rejects.toThrow("differs from the current name");
    await expect(service.renameTask(task.record.task_id, "Beta task"))
      .rejects.toThrow("A task folder already exists");

    expect(task.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Alpha task/task.md");
    expect(await vault.read(task.taskFile as never)).toBe(before);
  });

  it("rolls task folders and metadata back when the rename write fails", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const task = await service.createTask({
      taskId: "tsk_task_rename_rollback",
      title: "Original rollback task",
      details: "Keep this body."
    });
    await service.createRelatedNote(task.record.task_id, "Rollback evidence", "Keep this file.");
    const taskBefore = await vault.read(task.taskFile as never);
    const updatesBefore = await vault.read(task.updatesFile as never);
    vault.failNextWriteTarget = "08 Tasks/Inbox/Tasks/Renamed rollback task/task.md";

    await expect(service.renameTask(task.record.task_id, "Renamed rollback task"))
      .rejects.toThrow("Task rename failed: Simulated write failure");

    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Tasks/Renamed rollback task")).toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Updates/Renamed rollback task")).toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Files/Renamed rollback task")).toBeNull();
    expect(task.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Original rollback task/task.md");
    expect(task.updatesFile?.path).toBe("08 Tasks/Inbox/Updates/Original rollback task/updates.md");
    expect(await vault.read(task.taskFile as never)).toBe(taskBefore);
    expect(await vault.read(task.updatesFile as never)).toBe(updatesBefore);
    expect(service.getById(task.record.task_id).record.title).toBe("Original rollback task");
  });

  it("renames a project folder and synchronizes project and task metadata", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const project = await service.createProject("Project Alpha", "Keep this project context.");
    const task = await service.createTask({
      taskId: "tsk_project_rename",
      title: "Rename safely",
      project: project.record.name
    });
    const related = await service.createRelatedNote(task.record.task_id, "Rename evidence", "Keep this file.");
    await vault.create("08 Tasks/Projects/Project Alpha/Project notes.md", "Keep this project note.");
    const updatesBefore = await vault.read(task.updatesFile as never);

    const result = await service.renameProject("Project Alpha", "Project Beta");

    expect(result.updatedTaskCount).toBe(1);
    expect(result.project).toMatchObject({
      folderPath: "08 Tasks/Projects/Project Beta",
      record: {
        name: "Project Beta",
        location: "08 Tasks/Projects/Project Beta"
      }
    });
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/Project Alpha")).toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/Project Beta/Project notes.md")).not.toBeNull();

    const renamedTask = service.getById(task.record.task_id);
    expect(renamedTask.taskFile.path)
      .toBe("08 Tasks/Inbox/Tasks/Rename safely/task.md");
    expect(renamedTask.record.project).toBe("Project Beta");
    expect(renamedTask.record.location)
      .toBe("08 Tasks/Inbox/Tasks/Rename safely");
    expect(renamedTask.record.related_files)
      .toEqual(["08 Tasks/Inbox/Files/Rename safely/Rename evidence.md"]);
    expect(vault.getAbstractFileByPath(related.path)).not.toBeNull();
    expect(await vault.read(renamedTask.updatesFile as never)).toBe(updatesBefore);

    const projectMarkdown = await vault.read(result.project.projectFile as never);
    expect(projectMarkdown).toContain("name: Project Beta");
    expect(projectMarkdown).toContain("project: Project Beta");
    expect(projectMarkdown).toContain("location: 08 Tasks/Projects/Project Beta");
    expect(projectMarkdown).toContain("# Project Beta");
    expect(projectMarkdown).toContain("Keep this project context.");
  });

  it("rejects unsafe or colliding project rename targets before moving anything", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const project = await service.createProject("Project Alpha");
    await service.createProject("Project Beta");
    const before = await vault.read(project.projectFile as never);

    await expect(service.renameProject("Project Alpha", "Project/Beta"))
      .rejects.toThrow("Project names cannot contain");
    await expect(service.renameProject("Project Alpha", "Project Beta"))
      .rejects.toThrow("Project already exists: Project Beta");
    await expect(service.renameProject("Project Alpha", "project-alpha"))
      .rejects.toThrow("differs from the current name");

    expect(vault.getAbstractFileByPath("08 Tasks/Projects/Project Alpha")).not.toBeNull();
    expect(await vault.read(project.projectFile as never)).toBe(before);
  });

  it("rolls back the project folder and metadata when a rename write fails", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const project = await service.createProject("Project Alpha", "Original project notes.");
    const task = await service.createTask({
      taskId: "tsk_project_rename_rollback",
      title: "Keep original project",
      project: project.record.name
    });
    const projectBefore = await vault.read(project.projectFile as never);
    const taskBefore = await vault.read(task.taskFile as never);
    vault.failNextWriteTarget = "08 Tasks/Inbox/Tasks/Keep original project/task.md";

    await expect(service.renameProject("Project Alpha", "Project Beta"))
      .rejects.toThrow("Project rename failed: Simulated write failure");

    expect(vault.getAbstractFileByPath("08 Tasks/Projects/Project Beta")).toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/Project Alpha")).not.toBeNull();
    expect(await vault.read(project.projectFile as never)).toBe(projectBefore);
    expect(await vault.read(task.taskFile as never)).toBe(taskBefore);
    expect(service.getById(task.record.task_id).record.project).toBe("Project Alpha");
  });

  it("sets, changes, and clears a task due date while recording each change", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const created = await service.createTask({
      taskId: "tsk_inline_due_date",
      title: "Schedule the deadline"
    });

    const added = await service.changeDueDate(created.record.task_id, "2026-08-24");
    expect(added.record.due).toBe("2026-08-24");
    expect(parseTaskMarkdown(await vault.read(added.taskFile as never)).record.due).toBe("2026-08-24");
    expect(await vault.read(added.updatesFile as never)).toContain("Due date set to 2026-08-24.");

    const changed = await service.changeDueDate(created.record.task_id, "2026-08-28");
    expect(changed.record.due).toBe("2026-08-28");
    expect(await vault.read(changed.updatesFile as never))
      .toContain("Due date changed from 2026-08-24 to 2026-08-28.");

    const cleared = await service.changeDueDate(created.record.task_id, "");
    expect(cleared.record.due).toBe("");
    expect(parseTaskMarkdown(await vault.read(cleared.taskFile as never)).record.due).toBe("");
    expect(await vault.read(cleared.updatesFile as never)).toContain("Due date cleared (was 2026-08-28).");
  });

  it("rejects an invalid inline due date without changing the task or its history", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const created = await service.createTask({
      taskId: "tsk_invalid_inline_due_date",
      title: "Keep the current deadline",
      due: "2026-08-24"
    });
    const taskBefore = await vault.read(created.taskFile as never);
    const updatesBefore = await vault.read(created.updatesFile as never);

    await expect(service.changeDueDate(created.record.task_id, "August 30"))
      .rejects.toThrow("Invalid date: August 30");

    expect(await vault.read(created.taskFile as never)).toBe(taskBefore);
    expect(await vault.read(created.updatesFile as never)).toBe(updatesBefore);
  });

  it("lists only visible Program and Area subfolders as relocation destinations", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await vault.createFolder("02 Programs");
    await vault.createFolder("02 Programs/CalWORKs");
    await vault.createFolder("02 Programs/CalWORKs/Operations");
    await vault.createFolder("02 Programs/CalWORKs/.claude");
    await vault.createFolder("03 Areas");
    await vault.createFolder("03 Areas/Career");
    await vault.createFolder("08 Tasks/Other");

    expect(service.listRelocationDestinations()).toEqual([
      "02 Programs/CalWORKs",
      "02 Programs/CalWORKs/Operations",
      "03 Areas/Career"
    ]);
  });

  it("relocates the complete task workspace while preserving metadata, history, and files", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await vault.createFolder("02 Programs");
    await vault.createFolder("02 Programs/CalWORKs");
    await vault.createFolder("02 Programs/CalWORKs/Operations");
    const created = await service.createTask({
      taskId: "tsk_program_relocation",
      title: "Prepare program review",
      details: "Keep this task body intact.",
      status: "waiting",
      due: "2026-09-15",
      delegatedTo: "Dara"
    });
    const related = await service.createRelatedNote(
      created.record.task_id,
      "Review evidence",
      "Tracked source material."
    );
    const originalRelatedPath = related.path;
    const sourceTaskFolder = "08 Tasks/Inbox/Tasks/Prepare program review";
    const sourceUpdatesFolder = "08 Tasks/Inbox/Updates/Prepare program review";
    const sourceFilesFolder = "08 Tasks/Inbox/Files/Prepare program review";
    await vault.createFolder(`${sourceTaskFolder}/Application Materials`);
    await vault.create(`${sourceTaskFolder}/Application Materials/draft.docx`, "User-created task material.");
    await vault.createFolder(`${sourceUpdatesFolder}/Working Notes`);
    await vault.create(`${sourceUpdatesFolder}/Working Notes/checklist.md`, "Task update working notes.");
    await vault.createFolder(`${sourceFilesFolder}/Source bundle`);
    await vault.create(`${sourceFilesFolder}/Source bundle/untracked.txt`, "Untracked but task-owned.");
    await vault.create("08 Tasks/Inbox/Project background.md", "Unrelated workspace material.");
    await service.appendUpdate(created.record.task_id, {
      actor: "Franklin",
      text: "Collected the source packet."
    });

    const moved = await service.relocateTask(
      created.record.task_id,
      "02 Programs/CalWORKs/Operations"
    );

    expect(moved.taskFile.path).toBe(
      "02 Programs/CalWORKs/Operations/Operations Tasks/Prepare program review/task.md"
    );
    expect(moved.updatesFile?.path).toBe(
      "02 Programs/CalWORKs/Operations/Operations Tasks/Prepare program review/updates.md"
    );
    expect(moved.record).toMatchObject({
      task_id: "tsk_program_relocation",
      status: "waiting",
      project: "",
      location: "02 Programs/CalWORKs/Operations/Operations Tasks/Prepare program review",
      due: "2026-09-15",
      delegated_to: "Dara"
    });
    expect(moved.notes).toContain("Keep this task body intact.");
    expect(moved.record.related_files).toEqual([
      "02 Programs/CalWORKs/Operations/Operations Tasks/Prepare program review/Files/Review evidence.md"
    ]);
    expect(vault.getAbstractFileByPath(originalRelatedPath)).toBeNull();
    expect(vault.getAbstractFileByPath(
      "02 Programs/CalWORKs/Operations/Operations Tasks/Prepare program review/Files/Review evidence.md"
    )).not.toBeNull();
    expect(vault.getAbstractFileByPath(
      "02 Programs/CalWORKs/Operations/Operations Tasks/Prepare program review/Files/Source bundle/untracked.txt"
    )).not.toBeNull();
    expect(vault.getAbstractFileByPath(
      "02 Programs/CalWORKs/Operations/Operations Tasks/Prepare program review/Application Materials/draft.docx"
    )).not.toBeNull();
    expect(vault.getAbstractFileByPath(
      "02 Programs/CalWORKs/Operations/Operations Tasks/Prepare program review/Updates/Working Notes/checklist.md"
    )).not.toBeNull();
    expect(vault.getAbstractFileByPath(sourceTaskFolder)).toBeNull();
    expect(vault.getAbstractFileByPath(sourceUpdatesFolder)).toBeNull();
    expect(vault.getAbstractFileByPath(sourceFilesFolder)).toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Project background.md")).not.toBeNull();
    expect(await vault.read(moved.updatesFile as never)).toContain("Collected the source packet.");
    expect(await vault.read(moved.updatesFile as never)).toContain(
      "Task relocated from 08 Tasks/Inbox to 02 Programs/CalWORKs/Operations."
    );
    expect(service.getById(created.record.task_id).folderPath)
      .toBe("02 Programs/CalWORKs/Operations/Operations Tasks/Prepare program review");
    expect(service.relocationLocationForTask(created.record.task_id)).toBe("02 Programs/CalWORKs/Operations");
    expect(service.listRelocationDestinations()).not.toContain(
      "02 Programs/CalWORKs/Operations/Operations Tasks"
    );
  });

  it("keeps project assignment when relocating an assigned task", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await service.createProject("Project Alpha");
    await vault.createFolder("03 Areas");
    await vault.createFolder("03 Areas/Career");
    const created = await service.createTask({
      taskId: "tsk_area_relocation",
      title: "Prepare interview packet",
      project: "Project Alpha",
      status: "do-soon"
    });

    const moved = await service.relocateTask(created.record.task_id, "03 Areas/Career");

    expect(moved.record.project).toBe("Project Alpha");
    expect(moved.record.status).toBe("do-soon");
    expect(moved.folderPath).toBe("03 Areas/Career/Career Tasks/Prepare interview packet");
    expect(moved.taskFile.path).toBe("03 Areas/Career/Career Tasks/Prepare interview packet/task.md");
  });

  it("consolidates an earlier collection-style relocation into a named task collection", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await vault.createFolder("02 Programs");
    await vault.createFolder("02 Programs/Basic-Needs");
    await vault.createFolder("02 Programs/Basic-Needs/Tasks");
    await vault.createFolder("02 Programs/Basic-Needs/Tasks/Consolidate live task");
    await vault.createFolder("02 Programs/Basic-Needs/Updates");
    await vault.createFolder("02 Programs/Basic-Needs/Updates/Consolidate live task");
    const created = await service.createTask({
      taskId: "tsk_consolidate_relocation",
      title: "Consolidate live task"
    });
    await vault.renameFile(
      created.taskFile as never,
      "02 Programs/Basic-Needs/Tasks/Consolidate live task/task.md"
    );
    await vault.renameFile(
      created.updatesFile as never,
      "02 Programs/Basic-Needs/Updates/Consolidate live task/updates.md"
    );
    await service.refresh();

    expect(service.getById(created.record.task_id).relocatedBundle).toBe(false);
    const moved = await service.relocateTask(created.record.task_id, "02 Programs/Basic-Needs");

    expect(moved.relocatedBundle).toBe(true);
    expect(moved.folderPath).toBe("02 Programs/Basic-Needs/Basic Needs Tasks/Consolidate live task");
    expect(moved.taskFile.path).toBe("02 Programs/Basic-Needs/Basic Needs Tasks/Consolidate live task/task.md");
    expect(moved.updatesFile?.path)
      .toBe("02 Programs/Basic-Needs/Basic Needs Tasks/Consolidate live task/updates.md");
    expect(service.relocationLocationForTask(created.record.task_id)).toBe("02 Programs/Basic-Needs");
  });

  it("moves an existing relocated bundle from one folder to another without leaving task-owned material behind", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await vault.createFolder("03 Areas");
    await vault.createFolder("03 Areas/Career");
    await vault.createFolder("03 Areas/Leadership");
    const created = await service.createTask({
      taskId: "tsk_relocate_complete_bundle",
      title: "Prepare application packet",
      status: "do-soon",
      project: ""
    });
    const firstMove = await service.relocateTask(created.record.task_id, "03 Areas/Career");
    await vault.createFolder(`${firstMove.folderPath}/Application Materials`);
    await vault.create(
      `${firstMove.folderPath}/Application Materials/letter.docx`,
      "User-created material beside the managed Files folder."
    );
    await vault.create("03 Areas/Career/Program overview.md", "Unrelated project-level material.");

    const moved = await service.relocateTask(created.record.task_id, "03 Areas/Leadership");

    expect(moved.folderPath)
      .toBe("03 Areas/Leadership/Leadership Tasks/Prepare application packet");
    expect(moved.record).toMatchObject({
      task_id: "tsk_relocate_complete_bundle",
      status: "do-soon",
      project: "",
      location: "03 Areas/Leadership/Leadership Tasks/Prepare application packet"
    });
    expect(vault.getAbstractFileByPath(firstMove.folderPath)).toBeNull();
    expect(vault.getAbstractFileByPath(
      "03 Areas/Leadership/Leadership Tasks/Prepare application packet/Application Materials/letter.docx"
    )).not.toBeNull();
    expect(vault.getAbstractFileByPath("03 Areas/Career/Program overview.md")).not.toBeNull();
    expect(await vault.read(moved.updatesFile as never))
      .toContain("Task relocated from 03 Areas/Career to 03 Areas/Leadership.");
  });

  it("moves a task-owned shared file and rewrites the other task reference", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await vault.createFolder("03 Areas");
    await vault.createFolder("03 Areas/Fiscal");
    const first = await service.createTask({ taskId: "tsk_relocate_shared", title: "Move shared packet" });
    const second = await service.createTask({ taskId: "tsk_keep_shared", title: "Keep shared packet" });
    const shared = await service.createRelatedNote(first.record.task_id, "Shared packet", "Used twice.");
    const originalSharedPath = shared.path;
    const secondDocument = parseTaskMarkdown(await vault.read(second.taskFile as never));
    await vault.modify(
      second.taskFile as never,
      renderTaskMarkdown(updateTaskFields(secondDocument.record, { related_files: [shared.path] }), secondDocument.body)
    );
    await service.refresh();

    const moved = await service.relocateTask(first.record.task_id, "03 Areas/Fiscal");

    const movedSharedPath = "03 Areas/Fiscal/Fiscal Tasks/Move shared packet/Files/Shared packet.md";
    expect(moved.record.related_files).toEqual([movedSharedPath]);
    expect(service.getById(second.record.task_id).record.related_files).toEqual([movedSharedPath]);
    expect(vault.getAbstractFileByPath(originalSharedPath)).toBeNull();
    expect(vault.getAbstractFileByPath(movedSharedPath)).not.toBeNull();
  });

  it("rejects an ineligible relocation without changing the task", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await vault.createFolder("10 Misc");
    await vault.createFolder("10 Misc/Unsorted");
    const created = await service.createTask({
      taskId: "tsk_invalid_relocation",
      title: "Stay in Inbox"
    });
    const taskBefore = await vault.read(created.taskFile as never);
    const updatesBefore = await vault.read(created.updatesFile as never);

    await expect(service.relocateTask(created.record.task_id, "10 Misc/Unsorted"))
      .rejects.toThrow("Choose a folder inside 02 Programs or 03 Areas.");

    expect(created.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Stay in Inbox/task.md");
    expect(await vault.read(created.taskFile as never)).toBe(taskBefore);
    expect(await vault.read(created.updatesFile as never)).toBe(updatesBefore);
  });

  it("rolls back content, history, and files when relocation fails", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await vault.createFolder("02 Programs");
    await vault.createFolder("02 Programs/Foundation");
    const created = await service.createTask({
      taskId: "tsk_relocation_rollback",
      title: "Keep relocation atomic",
      details: "Original task body."
    });
    await service.createRelatedNote(created.record.task_id, "Rollback evidence", "Must return.");
    const taskBefore = await vault.read(created.taskFile as never);
    const updatesBefore = await vault.read(created.updatesFile as never);
    vault.failNextRenameTarget = "02 Programs/Foundation/Foundation Tasks/Keep relocation atomic";

    await expect(service.relocateTask(created.record.task_id, "02 Programs/Foundation"))
      .rejects.toThrow("Task relocation failed: Simulated rename failure");

    expect(created.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Keep relocation atomic/task.md");
    expect(created.updatesFile?.path).toBe("08 Tasks/Inbox/Updates/Keep relocation atomic/updates.md");
    expect(vault.getAbstractFileByPath(
      "08 Tasks/Inbox/Files/Keep relocation atomic/Rollback evidence.md"
    )).not.toBeNull();
    expect(await vault.read(created.taskFile as never)).toBe(taskBefore);
    expect(await vault.read(created.updatesFile as never)).toBe(updatesBefore);
  });

  it("previews and migrates a legacy flat task without moving untracked files", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const record = createTaskRecord({ taskId: "tsk_migrate_flat", title: "Migrate a flat task" });
    const taskFile = await vault.create("08 Tasks/Inbox/Tasks/Migrate a flat task.md", renderTaskMarkdown(record, "# Migrate a flat task"));
    await vault.create("08 Tasks/Inbox/Updates/Migrate a flat task.md", renderUpdatesMarkdown());
    await vault.create("08 Tasks/Inbox/Files/Attached.md", "Attached");
    await vault.create("08 Tasks/Inbox/Files/Untracked.md", "Leave in place");
    const document = parseTaskMarkdown(await vault.read(taskFile as never));
    await vault.modify(taskFile as never, renderTaskMarkdown(updateTaskFields(document.record, {
      related_files: ["08 Tasks/Inbox/Files/Attached.md"]
    }), document.body));
    await service.refresh();

    expect(service.previewTaskArtifactMigration()).toContainEqual(expect.objectContaining({
      taskId: "tsk_migrate_flat",
      eligible: true,
      to: "08 Tasks/Inbox/Tasks/Migrate a flat task/task.md"
    }));
    const result = await service.migrateTaskArtifacts();

    expect(result).toMatchObject({ migrated: 1, attachmentMoves: 1, errors: [] });
    const migrated = service.getById("tsk_migrate_flat");
    expect(migrated.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Migrate a flat task/task.md");
    expect(migrated.updatesFile?.path).toBe("08 Tasks/Inbox/Updates/Migrate a flat task/updates.md");
    expect(migrated.record.related_files).toEqual(["08 Tasks/Inbox/Files/Migrate a flat task/Attached.md"]);
    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Files/Untracked.md")).not.toBeNull();
    expect(service.previewTaskArtifactMigration().find((item) => item.taskId === "tsk_migrate_flat")?.reason)
      .toBe("already uses task-specific folders");
  });

  it("isolates a failed migration and leaves the flat task intact", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const record = createTaskRecord({ taskId: "tsk_migrate_rollback", title: "Keep flat on failure" });
    await vault.create("08 Tasks/Inbox/Tasks/Keep flat on failure.md", renderTaskMarkdown(record, "# Keep flat on failure"));
    await vault.create("08 Tasks/Inbox/Updates/Keep flat on failure.md", renderUpdatesMarkdown());
    await service.refresh();
    vault.failNextRenameTarget = "08 Tasks/Inbox/Tasks/Keep flat on failure/task.md";

    const result = await service.migrateTaskArtifacts();

    expect(result.migrated).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(service.getById("tsk_migrate_rollback").taskFile.path)
      .toBe("08 Tasks/Inbox/Tasks/Keep flat on failure.md");
    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Updates/Keep flat on failure.md")).not.toBeNull();
  });











  it("sets, changes, and clears a project tag without moving task files", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const created = await service.createTask({
      taskId: "tsk_project_tag_change",
      title: "Review the support packet",
      status: "do-first"
    });
    const related = await service.createRelatedNote(created.record.task_id, "Evidence", "Keep this here.");
    const taskPath = created.taskFile.path;
    const updatesPath = created.updatesFile?.path;
    const relatedPath = related.path;

    const assigned = await service.changeProject(created.record.task_id, "Basic Needs Expansion");
    expect(assigned.record.project).toBe("Basic Needs Expansion");
    expect(assigned.record.tags).toContain("project/Basic_Needs_Expansion");
    expect(assigned.taskFile.path).toBe(taskPath);
    expect(assigned.updatesFile?.path).toBe(updatesPath);
    expect(assigned.record.related_files).toEqual([relatedPath]);
    expect(vault.getAbstractFileByPath(relatedPath)).not.toBeNull();
    expect(await vault.read(assigned.updatesFile as never))
      .toContain("Project tag changed from No project to Basic Needs Expansion. Task location unchanged.");

    const changed = await service.changeProject(created.record.task_id, "Housing Initiative");
    expect(changed.record.tags).toContain("project/Housing_Initiative");
    expect(changed.record.tags).not.toContain("project/Basic_Needs_Expansion");
    expect(changed.taskFile.path).toBe(taskPath);

    const cleared = await service.changeProject(created.record.task_id, "");
    expect(cleared.record.project).toBe("");
    expect(cleared.record.tags.some((tag) => tag.startsWith("project/"))).toBe(false);
    expect(cleared.taskFile.path).toBe(taskPath);
  });

  it("keeps a relocated Program or Area task in place when its project tag changes", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await vault.createFolder("03 Areas");
    await vault.createFolder("03 Areas/Career");
    const task = await service.createTask({
      taskId: "tsk_relocated_project_tag",
      title: "Relocated project task",
      status: "waiting",
      due: "2026-09-20"
    });
    await service.createRelatedNote(task.record.task_id, "Relocated packet", "Keep this file.");
    const relocated = await service.relocateTask(task.record.task_id, "03 Areas/Career");
    await vault.create(`${relocated.folderPath}/Files/untracked-evidence.pdf`, "untracked pdf placeholder");
    const pathBefore = relocated.taskFile.path;
    const locationBefore = relocated.record.location;
    const relatedBefore = [...relocated.record.related_files];

    const tagged = await service.changeProject(task.record.task_id, "Basic Needs Expansion");

    expect(tagged.record.project).toBe("Basic Needs Expansion");
    expect(tagged.record.tags).toContain("project/Basic_Needs_Expansion");
    expect(tagged.taskFile.path).toBe(pathBefore);
    expect(tagged.folderPath).toBe(relocated.folderPath);
    expect(tagged.record.location).toBe(locationBefore);
    expect(tagged.record.related_files).toEqual(relatedBefore);
    expect(vault.getAbstractFileByPath(`${relocated.folderPath}/Files/untracked-evidence.pdf`)).not.toBeNull();
  });

  it("creates tagged tasks in Inbox without requiring a project folder", async () => {
    const { service, vault } = createService();
    await service.initialize();

    const task = await service.createTask({
      taskId: "tsk_tag_without_folder",
      title: "Start new initiative",
      project: "New Initiative"
    });

    expect(task.record.project).toBe("New Initiative");
    expect(task.record.tags).toContain("project/New_Initiative");
    expect(task.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Start new initiative/task.md");
    expect(task.updatesFile?.path).toBe("08 Tasks/Inbox/Updates/Start new initiative/updates.md");
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/New Initiative")).toBeNull();
    expect(service.projectNames()).toContain("New Initiative");
  });

  it("rolls task and history metadata back when a project tag write fails", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const created = await service.createTask({
      taskId: "tsk_project_tag_rollback",
      title: "Restore after write failure"
    });
    const taskBefore = await vault.read(created.taskFile as never);
    const updatesBefore = await vault.read(created.updatesFile as never);
    vault.failNextWriteTarget = created.taskFile.path;

    await expect(service.changeProject(created.record.task_id, "Project Alpha"))
      .rejects.toThrow("Task project tag change failed: Simulated write failure");

    const unchanged = service.getById(created.record.task_id);
    expect(unchanged.record.project).toBe("");
    expect(unchanged.taskFile.path).toBe(created.taskFile.path);
    expect(await vault.read(unchanged.taskFile as never)).toBe(taskBefore);
    expect(await vault.read(unchanged.updatesFile as never)).toBe(updatesBefore);
  });

  it("backfills existing project fields to tags without moving the task", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const task = await service.createTask({
      taskId: "tsk_project_tag_migration",
      title: "Existing project task",
      project: "Basic Needs Expansion"
    });
    const originalPath = task.taskFile.path;
    const withoutTag = (await vault.read(task.taskFile as never))
      .replace("  - project/Basic_Needs_Expansion\n", "");
    await vault.modify(task.taskFile as never, withoutTag);
    await service.refresh();

    await expect(service.migrateProjectTags()).resolves.toBe(1);

    const migrated = service.getById(task.record.task_id);
    expect(migrated.taskFile.path).toBe(originalPath);
    expect(await vault.read(migrated.taskFile as never)).toContain("  - project/Basic_Needs_Expansion");
  });

  it("uses the legacy workspace Files fallback when a task record is outside its artifact folder", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await service.createProject("Project Alpha");
    const created = await service.createTask({
      taskId: "tsk_copy_project_folder_test",
      title: "Email project update",
      status: "do-first",
      project: "Project Alpha"
    });

    await vault.renameFile(created.taskFile as never, "08 Tasks/Inbox/Tasks/Email project update.md");
    await service.refresh();

    expect(service.getById(created.record.task_id).folderPath).toBe("08 Tasks/Inbox");
    expect(service.copyFolderForTask(created.record.task_id)).toEqual({
      folderPath: "08 Tasks/Inbox/Files",
      legacy: false
    });
  });

  it("creates browser-clipped tasks in Inbox with optional project tags", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await service.createProject("Project Alpha");

    const inboxTask = await service.createFromClip({
      title: "Review clipped article",
      details: "Selected browser text",
      status: "inbox",
      project: "",
      tags: ["task"],
      source: { type: "web", title: "Source article", url: "https://example.com/article" }
    }, "req_clipper_inbox", "2026-08-10T16:00:00.000Z");
    const projectTask = await service.createFromClip({
      title: "Send project follow-up",
      details: "Project-specific selected text",
      status: "do-first",
      project: "Project Alpha",
      tags: ["task"],
      source: { type: "web", title: "Project source", url: "https://example.com/project" }
    }, "req_clipper_project", "2026-08-10T16:05:00.000Z");

    expect(inboxTask.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Review clipped article/task.md");
    expect(inboxTask.updatesFile?.path).toBe("08 Tasks/Inbox/Updates/Review clipped article/updates.md");
    expect(projectTask.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Send project follow-up/task.md");
    expect(projectTask.updatesFile?.path).toBe("08 Tasks/Inbox/Updates/Send project follow-up/updates.md");
    expect(projectTask.record.tags).toContain("project/Project_Alpha");
    expect(await vault.read(projectTask.taskFile as never)).toContain("source_url: https://example.com/project");
    expect(await vault.read(projectTask.updatesFile as never)).toContain("Request ID: `req_clipper_project`");
  });

  it("keeps clipped updates attached by stable task ID after a project tag change", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await service.createProject("Project Alpha");
    const created = await service.createFromClip({
      title: "Track browser research",
      details: "Initial selected text",
      status: "inbox",
      project: "",
      tags: ["task"],
      source: { type: "web", title: "Initial source", url: "https://example.com/initial" }
    }, "req_clipper_create", "2026-08-10T17:00:00.000Z");

    const moved = await service.changeProject(created.record.task_id, "Project Alpha");
    const resolved = service.findByIdOrQuery(created.record.task_id, "obsolete title text");
    expect(resolved.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Track browser research/task.md");

    const updated = await service.appendUpdate(resolved.record.task_id, {
      actor: "Browser clipper",
      type: "update",
      text: "New evidence clipped after the task moved.",
      source: { type: "web", title: "Follow-up source", url: "https://example.com/follow-up" },
      createdAt: "2026-08-10T17:15:00.000Z",
      requestId: "req_clipper_update"
    });

    expect(updated.record.task_id).toBe(created.record.task_id);
    expect(updated.updatesFile?.path).toBe("08 Tasks/Inbox/Updates/Track browser research/updates.md");
    expect(await vault.read(updated.updatesFile as never)).toContain("New evidence clipped after the task moved.");
    expect(await vault.read(updated.updatesFile as never)).toContain("Request ID: `req_clipper_update`");
    expect(moved.record.project).toBe("Project Alpha");

    const catalogEntry = service.catalog().find((task) => task.task_id === created.record.task_id);
    expect(catalogEntry).toMatchObject({
      project: "Project Alpha",
      path: "08 Tasks/Inbox"
    });
  });

  it("accepts a clipped project tag without requiring a registered project folder", async () => {
    const { service } = createService();
    await service.initialize();

    const task = await service.createFromClip({
      title: "Do not orphan this clip",
      details: "The selected project was deleted before capture.",
      status: "inbox",
      project: "Deleted Project",
      tags: ["task"],
      source: { type: "web", title: "Source", url: "https://example.com" }
    }, "req_missing_project", "2026-08-10T18:00:00.000Z");

    expect(task.record.project).toBe("Deleted Project");
    expect(task.record.tags).toContain("project/Deleted_Project");
    expect(task.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Do not orphan this clip/task.md");
  });
});

describe("TaskWorkspaceService briefing", () => {
  it("creates a clear empty briefing during refresh", async () => {
    const { service, vault } = createService();
    await service.initialize();

    const briefing = vault.getAbstractFileByPath(service.briefingPath());
    expect(briefing).toBeInstanceOf(obsidianMock.MockTFile);
    expect(await vault.read(briefing as InstanceType<typeof obsidianMock.MockTFile>))
      .toContain("No tasks or projects are currently indexed by FJG Task Manager.");
  });

  it("regenerates every dashboard task with scannable title, status, project, details, and history", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await service.createProject("Enrollment");
    const assigned = await service.createTask({
      taskId: "tsk_briefing_assigned",
      title: "Prepare weekly enrollment report",
      details: "Confirm the MIS totals with PRIE.",
      status: "waiting",
      due: "2026-08-21",
      project: "Enrollment",
      delegatedTo: "Dara"
    });
    await service.appendUpdate(assigned.record.task_id, {
      actor: "Franklin",
      type: "update",
      text: "PRIE sent the corrected enrollment extract."
    });
    await service.createTask({
      taskId: "tsk_briefing_unassigned",
      title: "Review unassigned follow-up",
      details: "Keep this visible without a project.",
      status: "do-first"
    });

    const briefing = await service.refreshBriefingNote(new Date("2026-08-16T20:00:00.000Z"));
    const markdown = await vault.read(briefing as unknown as InstanceType<typeof obsidianMock.MockTFile>);
    expect(markdown).toContain("task_count: 2");
    expect(markdown).toMatch(/#### Prepare weekly enrollment report[\s\S]*Status: \*\*Waiting\*\*[\s\S]*Project: Enrollment/);
    expect(markdown).toMatch(/#### Review unassigned follow-up[\s\S]*Status: \*\*Do First\*\*[\s\S]*Project: No Project/);
    expect(markdown).toContain("Due date: 2026-08-21");
    expect(markdown).toContain("Delegated to: Dara");
    expect(markdown).toContain("Confirm the MIS totals with PRIE.");
    expect(markdown).toContain("PRIE sent the corrected enrollment extract.");
    expect(markdown).toContain("- Project tag status: **Active**");
    expect(markdown).not.toContain("[[08 Tasks/Projects/Enrollment/project|Enrollment]]");
    expect(markdown).toContain("generated_at: 2026-08-16T20:00:00.000Z");
  });

  it("surfaces an explicit briefing write failure to the open-note action", async () => {
    const { service, vault } = createService();
    await service.initialize();
    vault.failNextWriteTarget = service.briefingPath();

    await expect(service.refreshBriefingNote()).rejects.toThrow("Simulated write failure");
  });
});
