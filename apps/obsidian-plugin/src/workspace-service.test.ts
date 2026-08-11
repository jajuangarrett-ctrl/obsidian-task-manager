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

class MockVault {
  private readonly entries = new Map<string, InstanceType<typeof obsidianMock.MockTFile> | InstanceType<typeof obsidianMock.MockTFolder>>();

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

  async createFolder(value: string) {
    const folder = new obsidianMock.MockTFolder(value);
    if (this.entries.has(folder.path)) throw new Error(`Already exists: ${folder.path}`);
    this.entries.set(folder.path, folder);
    return folder;
  }

  async create(value: string, content: string) {
    const file = new obsidianMock.MockTFile(value, content);
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
  it("moves Inbox task records and owned files into a project, then returns the records to Inbox", async () => {
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

    expect(created.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Move budget packet.md");
    expect(created.updatesFile?.path).toBe("08 Tasks/Inbox/Updates/Move budget packet.md");
    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Files/Move budget packet - Budget evidence.md")).not.toBeNull();
    expect(service.copyFolderForTask(created.record.task_id)).toEqual({
      folderPath: "08 Tasks/Inbox",
      projectName: ""
    });

    const assigned = await service.changeProject(created.record.task_id, "Project Alpha");
    expect(assigned.record.project).toBe("Project Alpha");
    expect(assigned.taskFile.path).toBe("08 Tasks/Projects/Project Alpha/Tasks/Move budget packet.md");
    expect(assigned.updatesFile?.path).toBe("08 Tasks/Projects/Project Alpha/Updates/Move budget packet.md");
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/Project Alpha/Files/Move budget packet - Budget evidence.md")).not.toBeNull();
    expect(await vault.read(assigned.updatesFile as never)).toContain("Project changed from No project to Project Alpha.");
    expect(service.copyFolderForTask(created.record.task_id)).toEqual({
      folderPath: "08 Tasks/Projects/Project Alpha",
      projectName: "Project Alpha"
    });

    const returned = await service.changeProject(created.record.task_id, "");
    expect(returned.record.project).toBe("");
    expect(returned.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Move budget packet.md");
    expect(returned.updatesFile?.path).toBe("08 Tasks/Inbox/Updates/Move budget packet.md");
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/Project Alpha/Files/Move budget packet - Budget evidence.md")).not.toBeNull();
    expect(await vault.read(returned.updatesFile as never)).toContain("Project changed from Project Alpha to No project.");

    await expect(service.changeProject(created.record.task_id, "Deleted Project")).rejects.toThrow(
      "Project not found: Deleted Project"
    );
    expect(service.getById(created.record.task_id).taskFile.path).toBe("08 Tasks/Inbox/Tasks/Move budget packet.md");
  });

  it("resolves a project folder from task metadata even when the indexed task file is in Inbox", async () => {
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
      folderPath: "08 Tasks/Projects/Project Alpha",
      projectName: "Project Alpha"
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

    expect(inboxTask.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Review clipped article.md");
    expect(inboxTask.updatesFile?.path).toBe("08 Tasks/Inbox/Updates/Review clipped article.md");
    expect(projectTask.taskFile.path).toBe("08 Tasks/Projects/Project Alpha/Tasks/Send project follow-up.md");
    expect(projectTask.updatesFile?.path).toBe("08 Tasks/Projects/Project Alpha/Updates/Send project follow-up.md");
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
    expect(resolved.taskFile.path).toBe("08 Tasks/Projects/Project Alpha/Tasks/Track browser research.md");

    const updated = await service.appendUpdate(resolved.record.task_id, {
      actor: "Browser clipper",
      type: "update",
      text: "New evidence clipped after the task moved.",
      source: { type: "web", title: "Follow-up source", url: "https://example.com/follow-up" },
      createdAt: "2026-08-10T17:15:00.000Z",
      requestId: "req_clipper_update"
    });

    expect(updated.record.task_id).toBe(created.record.task_id);
    expect(updated.updatesFile?.path).toBe("08 Tasks/Projects/Project Alpha/Updates/Track browser research.md");
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
