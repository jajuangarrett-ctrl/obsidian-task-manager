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

    const assigned = await service.changeProject(created.record.task_id, "Project Alpha");
    expect(assigned.record.project).toBe("Project Alpha");
    expect(assigned.taskFile.path).toBe("08 Tasks/Projects/Project Alpha/Tasks/Move budget packet.md");
    expect(assigned.updatesFile?.path).toBe("08 Tasks/Projects/Project Alpha/Updates/Move budget packet.md");
    expect(vault.getAbstractFileByPath("08 Tasks/Projects/Project Alpha/Files/Move budget packet - Budget evidence.md")).not.toBeNull();
    expect(await vault.read(assigned.updatesFile as never)).toContain("Project changed from No project to Project Alpha.");

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
});
