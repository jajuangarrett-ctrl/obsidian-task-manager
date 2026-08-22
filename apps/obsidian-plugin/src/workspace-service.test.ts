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
    const sourceFilesFolder = "08 Tasks/Inbox/Files/Prepare program review";
    await vault.createFolder(`${sourceFilesFolder}/Source bundle`);
    await vault.create(`${sourceFilesFolder}/Source bundle/untracked.txt`, "Untracked but task-owned.");
    await service.appendUpdate(created.record.task_id, {
      actor: "Franklin",
      text: "Collected the source packet."
    });

    const moved = await service.relocateTask(
      created.record.task_id,
      "02 Programs/CalWORKs/Operations"
    );

    expect(moved.taskFile.path).toBe(
      "02 Programs/CalWORKs/Operations/Tasks/Prepare program review/task.md"
    );
    expect(moved.updatesFile?.path).toBe(
      "02 Programs/CalWORKs/Operations/Updates/Prepare program review/updates.md"
    );
    expect(moved.record).toMatchObject({
      task_id: "tsk_program_relocation",
      status: "waiting",
      project: "",
      due: "2026-09-15",
      delegated_to: "Dara"
    });
    expect(moved.notes).toContain("Keep this task body intact.");
    expect(moved.record.related_files).toEqual([
      "02 Programs/CalWORKs/Operations/Files/Prepare program review/Review evidence.md"
    ]);
    expect(vault.getAbstractFileByPath(originalRelatedPath)).toBeNull();
    expect(vault.getAbstractFileByPath(
      "02 Programs/CalWORKs/Operations/Files/Prepare program review/Review evidence.md"
    )).not.toBeNull();
    expect(vault.getAbstractFileByPath(
      "02 Programs/CalWORKs/Operations/Files/Prepare program review/Source bundle/untracked.txt"
    )).not.toBeNull();
    expect(await vault.read(moved.updatesFile as never)).toContain("Collected the source packet.");
    expect(await vault.read(moved.updatesFile as never)).toContain(
      "Task relocated from 08 Tasks/Inbox to 02 Programs/CalWORKs/Operations."
    );
    expect(service.getById(created.record.task_id).folderPath).toBe("02 Programs/CalWORKs/Operations");
    expect(service.listRelocationDestinations()).not.toContain(
      "02 Programs/CalWORKs/Operations/Tasks/Prepare program review"
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
    expect(moved.folderPath).toBe("03 Areas/Career");
    expect(moved.taskFile.path).toBe("03 Areas/Career/Tasks/Prepare interview packet/task.md");
  });

  it("leaves a shared related file in place so other task references stay valid", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await vault.createFolder("03 Areas");
    await vault.createFolder("03 Areas/Fiscal");
    const first = await service.createTask({ taskId: "tsk_relocate_shared", title: "Move shared packet" });
    const second = await service.createTask({ taskId: "tsk_keep_shared", title: "Keep shared packet" });
    const shared = await service.createRelatedNote(first.record.task_id, "Shared packet", "Used twice.");
    const secondDocument = parseTaskMarkdown(await vault.read(second.taskFile as never));
    await vault.modify(
      second.taskFile as never,
      renderTaskMarkdown(updateTaskFields(secondDocument.record, { related_files: [shared.path] }), secondDocument.body)
    );
    await service.refresh();

    const moved = await service.relocateTask(first.record.task_id, "03 Areas/Fiscal");

    expect(moved.record.related_files).toEqual([shared.path]);
    expect(service.getById(second.record.task_id).record.related_files).toEqual([shared.path]);
    expect(vault.getAbstractFileByPath(shared.path)).not.toBeNull();
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
    vault.failNextRenameTarget = "02 Programs/Foundation/Tasks/Keep relocation atomic/task.md";

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

  it("moves explicitly related files with Inbox task records into a project and back", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await service.createProject("Project Alpha");
    const created = await service.createTask({
      taskId: "tsk_project_move_test",
      title: "Move budget packet",
      status: "do-first",
      details: "Keep the task history and supporting note together."
    });
    await service.createRelatedNote(created.record.task_id, "Budget evidence", "Source material");
    await vault.create("08 Tasks/Inbox/Files/Unrelated file.md", "Leave this file alone.");

    expect(created.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Move budget packet/task.md");
    expect(created.updatesFile?.path).toBe("08 Tasks/Inbox/Updates/Move budget packet/updates.md");
    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Files/Move budget packet/Budget evidence.md")).not.toBeNull();
    expect(service.copyFolderForTask(created.record.task_id)).toEqual({
      folderPath: "08 Tasks/Inbox/Files/Move budget packet",
      legacy: false
    });

    const assigned = await service.changeProject(created.record.task_id, "Project Alpha");
    expect(assigned.record.project).toBe("Project Alpha");
    expect(assigned.taskFile.path).toBe("08 Tasks/Projects/Project Alpha/Tasks/Move budget packet/task.md");
    expect(assigned.updatesFile?.path).toBe("08 Tasks/Projects/Project Alpha/Updates/Move budget packet/updates.md");
    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Files/tsk_project_move_test/Budget evidence.md")).toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/Project Alpha/Files/Move budget packet/Budget evidence.md")).not.toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Files/Unrelated file.md")).not.toBeNull();
    expect(await vault.read(assigned.updatesFile as never)).toContain("Project changed from No project to Project Alpha.");
    expect(service.copyFolderForTask(created.record.task_id)).toEqual({
      folderPath: "08 Tasks/Projects/Project Alpha/Files/Move budget packet",
      legacy: false
    });

    const returned = await service.changeProject(created.record.task_id, "");
    expect(returned.record.project).toBe("");
    expect(returned.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Move budget packet/task.md");
    expect(returned.updatesFile?.path).toBe("08 Tasks/Inbox/Updates/Move budget packet/updates.md");
    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Files/Move budget packet/Budget evidence.md")).not.toBeNull();
    expect(await vault.read(returned.updatesFile as never)).toContain("Project changed from Project Alpha to No project.");

    await expect(service.changeProject(created.record.task_id, "Deleted Project")).rejects.toThrow(
      "Project not found: Deleted Project"
    );
    expect(service.getById(created.record.task_id).taskFile.path).toBe("08 Tasks/Inbox/Tasks/Move budget packet/task.md");
  });

  it("returns distinct attachment destinations for tasks in the same project", async () => {
    const { service } = createService();
    await service.initialize();
    await service.createProject("Project Alpha");
    const first = await service.createTask({ taskId: "tsk_copy_one", title: "Shared project task", project: "Project Alpha" });
    const second = await service.createTask({ taskId: "tsk_copy_two", title: "Another project task", project: "Project Alpha" });

    expect(service.copyFolderForTask(first.record.task_id)).toEqual({
      folderPath: "08 Tasks/Projects/Project Alpha/Files/Shared project task",
      legacy: false
    });
    expect(service.copyFolderForTask(second.record.task_id)).toEqual({
      folderPath: "08 Tasks/Projects/Project Alpha/Files/Another project task",
      legacy: false
    });
  });

  it("creates the canonical Files location on demand for Inbox and project tasks", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await service.createProject("Project Alpha");
    const inboxTask = await service.createTask({ taskId: "tsk_inbox_location", title: "Inbox location" });
    const projectTask = await service.createTask({
      taskId: "tsk_project_location",
      title: "Project location",
      project: "Project Alpha"
    });

    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Files/Inbox location")).toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/Project Alpha/Files/Project location")).toBeNull();

    await expect(service.ensureFilesFolderForTask(inboxTask.record.task_id)).resolves.toEqual({
      folderPath: "08 Tasks/Inbox/Files/Inbox location",
      legacy: false
    });
    await expect(service.ensureFilesFolderForTask(projectTask.record.task_id)).resolves.toEqual({
      folderPath: "08 Tasks/Projects/Project Alpha/Files/Project location",
      legacy: false
    });

    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Files/Inbox location")).not.toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/Project Alpha/Files/Project location")).not.toBeNull();
  });

  it("moves task records directly between projects and creates a missing destination Tasks folder", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await service.createProject("Project Alpha");
    await service.createProject("Project Beta");
    const created = await service.createTask({
      taskId: "tsk_project_to_project",
      title: "Coordinate shared work",
      project: "Project Alpha"
    });
    await service.createRelatedNote(created.record.task_id, "Coordination notes", "Keep moving with the task.");
    const missingTasksFolder = vault.getAbstractFileByPath("08 Tasks/Projects/Project Beta/Tasks");
    if (missingTasksFolder) await vault.delete(missingTasksFolder as never);

    const moved = await service.changeProject(created.record.task_id, "Project Beta");

    expect(moved.record.project).toBe("Project Beta");
    expect(moved.taskFile.path).toBe("08 Tasks/Projects/Project Beta/Tasks/Coordinate shared work/task.md");
    expect(moved.updatesFile?.path).toBe("08 Tasks/Projects/Project Beta/Updates/Coordinate shared work/updates.md");
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/Project Beta/Tasks")).not.toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/Project Alpha/Files/tsk_project_to_project/Coordination notes.md")).toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/Project Beta/Files/Coordinate shared work/Coordination notes.md")).not.toBeNull();
  });

  it("does not move a related file referenced by more than one task", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await service.createProject("Project Alpha");
    const first = await service.createTask({ taskId: "tsk_shared_first", title: "First shared task" });
    const second = await service.createTask({ taskId: "tsk_shared_second", title: "Second shared task" });
    const shared = await service.createRelatedNote(first.record.task_id, "Shared brief", "Shared context.");
    const secondDocument = parseTaskMarkdown(await vault.read(second.taskFile as never));
    await vault.modify(
      second.taskFile as never,
      renderTaskMarkdown(updateTaskFields(secondDocument.record, { related_files: [shared.path] }), secondDocument.body)
    );
    await service.refresh();

    const moved = await service.changeProject(first.record.task_id, "Project Alpha");

    expect(moved.record.related_files).toEqual([shared.path]);
    expect(vault.getAbstractFileByPath(shared.path)).not.toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/Project Alpha/Files/tsk_shared_first/Shared brief.md")).toBeNull();
  });

  it("creates a standard project workspace before assigning and relocating a task", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const created = await service.createTask({
      taskId: "tsk_inline_project_create",
      title: "Start new initiative"
    });

    const project = await service.createProject("New Initiative");
    const assigned = await service.changeProject(created.record.task_id, project.record.name);

    expect(project.projectFile.path).toBe("08 Tasks/Projects/New Initiative/project.md");
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/New Initiative/Files")).not.toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/New Initiative/Tasks")).not.toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/New Initiative/Updates")).not.toBeNull();
    expect(assigned.record.project).toBe("New Initiative");
    expect(assigned.taskFile.path).toBe("08 Tasks/Projects/New Initiative/Tasks/Start new initiative/task.md");
  });

  it("rolls back record content and paths when a task-note move fails", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await service.createProject("Project Alpha");
    const created = await service.createTask({
      taskId: "tsk_project_move_rollback",
      title: "Keep assignment consistent"
    });
    await service.createRelatedNote(created.record.task_id, "Rollback evidence", "Must return after failure.");
    vault.failNextRenameTarget = "08 Tasks/Projects/Project Alpha/Tasks/Keep assignment consistent/task.md";

    await expect(service.changeProject(created.record.task_id, "Project Alpha")).rejects.toThrow("Simulated rename failure");

    const unchanged = service.getById(created.record.task_id);
    expect(unchanged.record.project).toBe("");
    expect(unchanged.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Keep assignment consistent/task.md");
    expect(unchanged.updatesFile?.path).toBe("08 Tasks/Inbox/Updates/Keep assignment consistent/updates.md");
    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Files/Keep assignment consistent/Rollback evidence.md")).not.toBeNull();
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/Project Alpha/Files/tsk_project_move_rollback/Rollback evidence.md")).toBeNull();
    expect(await vault.read(unchanged.taskFile as never)).toContain("project: \"\"");
    expect(await vault.read(unchanged.updatesFile as never)).not.toContain("Project changed from No project");
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

  it("creates browser-clipped tasks in Inbox or the selected project workspace", async () => {
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
    expect(projectTask.taskFile.path).toBe("08 Tasks/Projects/Project Alpha/Tasks/Send project follow-up/task.md");
    expect(projectTask.updatesFile?.path).toBe("08 Tasks/Projects/Project Alpha/Updates/Send project follow-up/updates.md");
    expect(await vault.read(projectTask.taskFile as never)).toContain("source_url: https://example.com/project");
    expect(await vault.read(projectTask.updatesFile as never)).toContain("Request ID: `req_clipper_project`");
  });

  it("keeps clipped updates attached by stable task ID after a project move", async () => {
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
    expect(resolved.taskFile.path).toBe("08 Tasks/Projects/Project Alpha/Tasks/Track browser research/task.md");

    const updated = await service.appendUpdate(resolved.record.task_id, {
      actor: "Browser clipper",
      type: "update",
      text: "New evidence clipped after the task moved.",
      source: { type: "web", title: "Follow-up source", url: "https://example.com/follow-up" },
      createdAt: "2026-08-10T17:15:00.000Z",
      requestId: "req_clipper_update"
    });

    expect(updated.record.task_id).toBe(created.record.task_id);
    expect(updated.updatesFile?.path).toBe("08 Tasks/Projects/Project Alpha/Updates/Track browser research/updates.md");
    expect(await vault.read(updated.updatesFile as never)).toContain("New evidence clipped after the task moved.");
    expect(await vault.read(updated.updatesFile as never)).toContain("Request ID: `req_clipper_update`");
    expect(moved.record.project).toBe("Project Alpha");

    const catalogEntry = service.catalog().find((task) => task.task_id === created.record.task_id);
    expect(catalogEntry).toMatchObject({
      project: "Project Alpha",
      path: "08 Tasks/Projects/Project Alpha"
    });
  });

  it("rejects a clipped task for a project that no longer exists", async () => {
    const { service } = createService();
    await service.initialize();

    await expect(service.createFromClip({
      title: "Do not orphan this clip",
      details: "The selected project was deleted before capture.",
      status: "inbox",
      project: "Deleted Project",
      tags: ["task"],
      source: { type: "web", title: "Source", url: "https://example.com" }
    }, "req_missing_project", "2026-08-10T18:00:00.000Z")).rejects.toThrow(
      "Project not found: Deleted Project"
    );
    expect(service.list()).toHaveLength(0);
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
    expect(markdown).toContain("[[08 Tasks/Projects/Enrollment/project|Enrollment]]");
    expect(markdown).toContain("generated_at: 2026-08-16T20:00:00.000Z");
  });

  it("surfaces an explicit briefing write failure to the open-note action", async () => {
    const { service, vault } = createService();
    await service.initialize();
    vault.failNextWriteTarget = service.briefingPath();

    await expect(service.refreshBriefingNote()).rejects.toThrow("Simulated write failure");
  });
});
