import { matchesHomeScope, filterHomeTasks } from "./home-model";
import { taskMatchesView, countTasksForView } from "./dashboard-model";
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

import { normalizeProtocolPayload } from "@fjg/task-protocol";
import { TaskWorkspaceService } from "./workspace-service";
import { LiveTaskTools } from "./live-tools";
import { createTaskRecord, parseTaskMarkdown, renderTaskMarkdown, renderUpdatesMarkdown, updateTaskFields } from "@fjg/task-core";

class MockVault {
  private readonly entries = new Map<string, InstanceType<typeof obsidianMock.MockTFile> | InstanceType<typeof obsidianMock.MockTFolder>>();
  failNextRenameTarget = "";
  failNextWriteTarget = "";
  failNextFolderTarget = "";
  failRemovePath = "";
  readonly hiddenFiles = new Set<string>();

  readonly adapter = {
    list: async (value: string) => {
      const prefix = `${obsidianMock.normalizePath(value)}/`;
      const children = [...this.entries.values()].filter((entry) =>
        entry.path.startsWith(prefix) && !entry.path.slice(prefix.length).includes("/"));
      return {
        files: children.filter((entry) => entry instanceof obsidianMock.MockTFile).map((entry) => entry.path),
        folders: children.filter((entry) => entry instanceof obsidianMock.MockTFolder).map((entry) => entry.path)
      };
    },
    rmdir: async (value: string, recursive: boolean) => {
      expect(recursive).toBe(false);
      const root = obsidianMock.normalizePath(value);
      if (root === this.failRemovePath) throw new Error("Simulated locked folder");
      if ([...this.entries.keys(), ...this.hiddenFiles].some((path) => path.startsWith(`${root}/`))) {
        throw new Error("Directory not empty");
      }
      this.entries.delete(root);
    },
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
    if (value === this.failNextFolderTarget) { this.failNextFolderTarget = ""; throw new Error("Simulated folder failure"); }
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

  async process(file: InstanceType<typeof obsidianMock.MockTFile>, update:(text:string)=>string) { const next=update(await this.read(file)); await this.modify(file,next); return next; }

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
      renameFile: (file: InstanceType<typeof obsidianMock.MockTFile> | InstanceType<typeof obsidianMock.MockTFolder>, target: string) => file instanceof obsidianMock.MockTFolder ? vault.rename(file, target) : vault.renameFile(file, target)
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
    vault, app,
    service: new TaskWorkspaceService(app as never, () => settings as never)
  };
}

describe("Live voice writes to authoritative task Markdown", () => {
  it("creates one editable Start Here note on demand and retains it through relocation", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const task = await service.createTask({ title: "Brief objective" });
    const id = task.record.task_id;
    expect(service.startHereFile(id)).toBeNull();
    const [first, second] = await Promise.all([service.ensureStartHereNote(id), service.ensureStartHereNote(id)]);
    expect(first.path).toBe(second.path);
    const body = await vault.read(first as never);
    expect(body).toContain("## Outcome");
    expect(body).toContain("## Open questions / waiting");
    expect(body).toContain("## Next action");
    expect(body).toContain("## Current status");
    expect(body).toContain("## Key files");
    await vault.createFolder("02 Programs/Basic-Needs");
    await service.relocateTask(id, "02 Programs/Basic-Needs");
    const moved = service.startHereFile(id)!;
    expect(moved.path).toContain("02 Programs/Basic-Needs");
    expect(await service.ensureStartHereNote(id)).toBe(moved);
  });

  it("creates a voice action under an exact parent with persisted fields and attachment folder", async () => {
    const {service,vault}=createService();await service.initialize();
    const parent=await service.createTask({title:"Work Study"});
    const other=await service.createTask({title:"Work Study follow-up"});
    const changed=vi.fn();let active=true;
    const tools=new LiveTaskTools(service,()=>({activeRoot:"08 Tasks/Workspaces",inboxRoot:"08 Tasks/Inbox",projectRoot:"08 Tasks/Projects"}) as never,changed,()=>active);
    const read=()=>tools.execute("read_task",JSON.stringify({task_id:parent.record.task_id}),"read") as Promise<any>;
    let current=await read();
    const args={task_id:parent.record.task_id,expected_revision:current.revision,title:"Review invoices",notes:"Check the supporting receipts",due:"2026-09-20",status:"waiting"};
    await expect(tools.execute("create_action",JSON.stringify({...args,expected_revision:"stale"}),"stale")).rejects.toThrow("changed since");
    const result=await tools.execute("create_action",JSON.stringify(args),"create-action") as any;
    expect(result.saved).toBe(true);expect(result.parent.task_id).toBe(parent.record.task_id);
    expect(result.action).toMatchObject({title:args.title,notes:args.notes,due:args.due,status:"waiting"});
    expect(service.getById(other.record.task_id).record.subtasks).toEqual([]);
    const stored=parseTaskMarkdown(await vault.read(service.getById(parent.record.task_id).taskFile as never));
    expect(stored.record.subtasks).toEqual([result.action]);
    expect(await vault.adapter.stat(service.subtaskFolder(parent.record.task_id,result.action.id))).toEqual({type:"folder"});
    current=await read();expect(current.actions[0].id).toBe(result.action.id);
    const duplicate=await tools.execute("create_action",JSON.stringify({...args,expected_revision:current.revision}),"duplicate") as any;
    expect(duplicate.error).toContain("already has");expect(changed).toHaveBeenCalledTimes(1);
    active=false;await expect(tools.execute("create_action",JSON.stringify(args),"cancelled")).rejects.toThrow("ended");
    active=true;await service.changeStatus(parent.record.task_id,"archived");current=await read();
    await expect(tools.execute("create_action",JSON.stringify({...args,expected_revision:current.revision,title:"Another"}),"completed")).resolves.toMatchObject({saved:true});
  });

  it("searches all indexed notes, updates and nested actions with ranked non-phrase matching", async () => {
    const {service}=createService();await service.initialize();
    const task=await service.createTask({title:"Late folder item",details:"Student enrollment budget planning"});
    await service.addSubtask(task.record.task_id,"Staffing review",{notes:"Counselor schedules"});
    await service.appendUpdate(task.record.task_id,{text:"Quarterly grant renewal",actor:"Test"});
    const coverage=vi.fn();const tools=new LiveTaskTools(service,()=>({}) as never,vi.fn(),()=>true,coverage);
    for(const query of ["budget student","counselor schedules","grant quarterly"]){
      const result=await tools.execute("find_tasks",JSON.stringify({query,status:"",offset:0}),"search") as any;
      expect(result.tasks[0].task_id).toBe(task.record.task_id);expect(result.scanned_tasks).toBe(1);expect(result.search_complete).toBe(true);
    }
    expect(coverage).toHaveBeenCalled();
  });

  const settings = { activeRoot: "08 Tasks/Workspaces", inboxRoot: "08 Tasks/Inbox", projectRoot: "08 Tasks/Projects" };
  it("creates, updates due date, appends an update, and completes the same task with persisted data", async () => {
    const { service, vault } = createService(); await service.initialize();
    const saved = vi.fn(); const tools = new LiveTaskTools(service, () => settings as never, saved, () => true);
    const result = await tools.execute("create_task", JSON.stringify({ title: "Voice fixture", details: "Test only", status: "do-first", due: "2026-09-15" }), "create-1") as any;
    let task = result.task;
    for (const [operation, value] of [["due", "2026-09-20"], ["update", "Reviewed the draft"], ["status", "completed"]]) {
      const result = await tools.execute("change_task", JSON.stringify({ task_id: task.task_id, expected_revision: task.revision, operation, value }), operation) as any;
      expect(result.saved).toBe(true); task = result.task;
    }
    const indexed = service.getById(task.task_id);
    const markdown = parseTaskMarkdown(await vault.read(indexed.taskFile as never));
    expect(markdown.record.status).toBe("completed"); expect(markdown.record.due).toBe("2026-09-20");
    expect(markdown.record.task_id).toBe(task.task_id);
    expect(await vault.read(indexed.updatesFile as never)).toContain("Reviewed the draft");
    expect(saved).toHaveBeenCalledTimes(4);
  });
  it("rejects stale revisions, invalid dates, archive, unknown IDs, and cancelled writes", async () => {
    const { service } = createService(); await service.initialize();
    const task = await service.createTask({ title: "Original" });
    let active = true;
    const tools = new LiveTaskTools(service, () => settings as never, vi.fn(), () => active);
    const read = await tools.execute("read_task", JSON.stringify({ task_id: task.record.task_id }), "read") as any;
    const change = (operation: string, value: string, rev = read.revision) => tools.execute("change_task", JSON.stringify({ task_id: task.record.task_id, expected_revision: rev, operation, value }), "change");
    await expect(change("due", "2026-02-30")).rejects.toThrow("valid due date");
    await expect(change("status", "archived")).rejects.toThrow("cannot archive");
    await expect(change("rename", "Changed", "stale")).rejects.toThrow("changed since");
    await expect(tools.execute("read_task", '{"task_id":"missing"}', "read2")).rejects.toThrow("No task");
    active = false; await expect(change("update", "Should not save")).rejects.toThrow("ended");
    expect(service.getById(task.record.task_id).record.title).toBe("Original");
  });
  it("returns ambiguous candidates, avoids duplicate creation, and rejects writes outside configured roots", async () => {
    const { service } = createService(); await service.initialize();
    const a = await service.createTask({ title: "Budget review" });
    await service.createTask({ title: "Budget review" });
    const tools = new LiveTaskTools(service, () => settings as never, vi.fn(), () => true);
    const matches = await tools.execute("find_tasks", '{"query":"Budget review","status":"","offset":0}', "search") as any;
    expect(matches.tasks).toHaveLength(2);
    const duplicate = await tools.execute("create_task", '{"title":"Budget review","details":"","due":"","status":"do-first"}', "create") as any;
    expect(duplicate.error).toContain("already exists"); expect(service.list()).toHaveLength(2);
    const blocked = new LiveTaskTools(service, () => ({ activeRoot: "Other", inboxRoot: "Other", projectRoot: "Other" }) as never, vi.fn(), () => true);
    await expect(blocked.execute("change_task", JSON.stringify({ task_id: a.record.task_id, expected_revision: matches.tasks.find((t: any) => t.task_id === a.record.task_id).revision, operation: "update", value: "blocked" }), "write")).rejects.toThrow("outside");
  });
});

describe("TaskWorkspaceService project-centered moves", () => {
  it("persists action order by ID while keeping fields, attachments and sibling objectives intact", async () => {
    const { service, vault } = createService(); await service.initialize();
    const parent = await service.createTask({ title: "Ordered objective", status: "do-first" });
    const other = await service.createTask({ title: "Unchanged objective", status: "do-first" });
    const id = parent.record.task_id;
    const a = await service.addSubtask(id, "Same title", { notes: "Preserve me", due: "2026-09-25", status: "waiting" });
    const b = await service.addSubtask(id, "Same title");
    const c = await service.addSubtask(id, "Last action");
    const folder = service.subtaskFolder(id, a.id);
    await vault.create(`${folder}/Evidence.md`, "Keep attachment");
    await service.moveSubtask(id, b.id, "up"); await service.refresh();
    expect(service.getById(id).record.subtasks).toEqual([b, a, c]);
    await service.moveSubtask(id, b.id, "up");
    expect(service.getById(id).record.subtasks).toEqual([b, a, c]);
    await service.moveSubtask(id, a.id, "down"); await service.refresh();
    expect(service.getById(id).record.subtasks).toEqual([b, c, a]);
    expect(service.subtaskFolder(id, a.id)).toBe(folder);
    expect(service.subtaskFiles(id, a.id).map(f => f.path)).toEqual([`${folder}/Evidence.md`]);
    expect(service.getById(other.record.task_id).record.subtasks).toEqual([]);
    await expect(service.moveSubtask(id, "missing", "up")).rejects.toThrow("Action not found");
    expect(service.getById(id).record.subtasks).toEqual([b, c, a]);
    await service.changeStatus(id, "archived");
    await expect(service.moveSubtask(id, a.id, "up")).resolves.toBeUndefined();
  });

  it("captures a complete action under the exact objective with a ready attachment folder", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const parent = await service.createTask({ title: "Action capture objective", status: "do-first" });
    const other = await service.createTask({ title: "Other objective", status: "do-first" });
    const action = await service.addSubtask(parent.record.task_id, "Review proposal", { status: "waiting", due: "2026-09-20", notes: "Ask for the revised budget." });
    await service.refresh();
    const stored = service.getById(parent.record.task_id);
    expect(stored.record.subtasks).toEqual([action]);
    expect(action).toMatchObject({ status: "waiting", due: "2026-09-20", notes: "Ask for the revised budget.", completed: false });
    expect(await vault.adapter.stat(service.subtaskFolder(parent.record.task_id, action.id))).toEqual({ type: "folder" });
    expect(service.getById(other.record.task_id).record.subtasks).toEqual([]);
    expect(await vault.read(stored.taskFile as never)).toContain("task_id:");
    await expect(service.addSubtask(parent.record.task_id, "  ")).rejects.toThrow("Enter an action title");
    await service.changeStatus(parent.record.task_id, "archived");
    await expect(service.addSubtask(parent.record.task_id, "Allowed completed action")).resolves.toMatchObject({title:"Allowed completed action"});
  });
  it("keeps subtask destinations and captured emails through parent rename, relocation and archive/reopen", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const parent = await service.createTask({ title: "Subtask parent", status: "do-first" });
    const id = parent.record.task_id;
    const sub = await service.addSubtask(id, "Review email");
    const firstPath = service.subtaskFolder(id, sub.id);
    await vault.create(`${firstPath}/Email.md`, "Captured email");
    await service.refresh();
    await service.updateSubtask(id, sub.id, { status: "completed", due: "2026-09-20" });
    await service.renameTask(id, "Renamed parent");
    expect(service.subtaskFiles(id, sub.id)).toHaveLength(1);
    expect(service.subtaskFolder(id, sub.id)).not.toBe(firstPath);
    await vault.createFolder("02 Programs/Test");
    await service.relocateTask(id, "02 Programs/Test");
    expect(service.subtaskFolder(id, sub.id)).toContain("02 Programs/Test/");
    expect(service.subtaskFiles(id, sub.id)[0].name).toBe("Email.md");
    await service.changeStatus(id, "archived");
    expect(service.subtaskFiles(id, sub.id)).toHaveLength(1);
    await service.changeStatus(id, "do-first");
    expect(service.subtaskFiles(id, sub.id)).toHaveLength(1);
    expect(service.getById(id).record.subtasks[0]).toMatchObject({ completed: true, due: "2026-09-20" });
  });

  it("converts existing work with files and history, then promotes it without stranding attachments", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const parent = await service.createTask({ title: "Parent" });
    const source = await service.createTask({ title: "Existing work", details: "Keep the context", due: "2026-09-19", status: "waiting" });
    await service.addSubtask(parent.record.task_id, "Other action");
    await service.createRelatedNote(source.record.task_id, "Email", "Keep the email");
    await service.appendUpdate(source.record.task_id, { actor: "Franklin", text: "Approval requested" });
    await service.convertTaskToSubtask(source.record.task_id, parent.record.task_id);
    const sub = service.getById(parent.record.task_id).record.subtasks.find((item) => item.source_task_id === source.record.task_id)!;
    expect(sub.notes).toContain("Keep the context");
    expect(sub.history).toContain("Approval requested");
    expect(sub.status).toBe("waiting");
    expect(service.getById(source.record.task_id).record.status).toBe(source.record.status);
    expect(service.subtaskFiles(parent.record.task_id, sub.id)).toHaveLength(1);
    const promoted = await service.promoteSubtask(parent.record.task_id, sub.id);
    expect(promoted.record).toMatchObject({ status: "waiting", due: "2026-09-19" });
    expect(promoted.relatedFiles.some((file) => file.file.name === "Email.md")).toBe(true);
    expect(service.getById(parent.record.task_id).record.subtasks).toHaveLength(1);
    expect(await vault.read(promoted.updatesFile as never)).toContain("Approval requested");
  });

  it("moves a previously converted action with its history, files and references instead of duplicating it", async () => {
    const { service, vault } = createService(); await service.initialize();
    const previous = await service.createTask({ title: "Previous parent" });
    const parent = await service.createTask({ title: "New parent" });
    const source = await service.createTask({ title: "Existing converted source" });
    const action = await service.addSubtask(previous.record.task_id, source.record.title, { status: "waiting", due: "2026-10-25", notes: "Retain action edits" });
    const previousDocument = parseTaskMarkdown(await vault.read(previous.taskFile as never));
    await vault.modify(previous.taskFile as never, renderTaskMarkdown(updateTaskFields(previousDocument.record, {
      subtasks: [{ ...action, source_task_id: source.record.task_id, history: "Original update history" }]
    }), previousDocument.body));
    const from = service.subtaskFolder(previous.record.task_id, action.id);
    const evidence = await vault.create(`${from}/Email.md`, "Keep the email");
    const sourceDocument = parseTaskMarkdown(await vault.read(source.taskFile as never));
    await vault.modify(source.taskFile as never, renderTaskMarkdown(updateTaskFields(sourceDocument.record, { related_files: [evidence.path] }), sourceDocument.body));
    // An existing action directory must survive, even when the title matches.
    const sibling = await service.addSubtask(parent.record.task_id, action.title);
    await vault.create(`${service.subtaskFolder(parent.record.task_id, sibling.id)}/Other.md`, "Keep sibling");
    await service.refresh();
    await service.convertTaskToSubtask(source.record.task_id, parent.record.task_id);
    const stored = service.getById(parent.record.task_id).record.subtasks;
    expect(stored).toHaveLength(2);
    expect(stored[1]).toMatchObject({ ...action, source_task_id: source.record.task_id, history: "Original update history", attachment_folder: `Subtasks/${action.title} (2)` });
    expect(service.getById(previous.record.task_id).record.subtasks).toEqual([]);
    expect(service.subtaskFiles(parent.record.task_id, action.id).map((file) => file.name)).toEqual(["Email.md"]);
    expect(service.getById(source.record.task_id).record.status).toBe(source.record.status);
    expect(service.getById(source.record.task_id).record.related_files).toContain(`${service.subtaskFolder(parent.record.task_id, action.id)}/Email.md`);
    expect(service.subtaskFiles(parent.record.task_id, sibling.id).map((file) => file.name)).toEqual(["Other.md"]);
  });

  it("marks a remaining standalone copy converted when its action is already in the selected parent", async () => {
    const { service, vault } = createService(); await service.initialize();
    const parent = await service.createTask({ title: "Existing parent" });
    const source = await service.createTask({ title: "Remaining standalone copy" });
    const action = await service.addSubtask(parent.record.task_id, source.record.title);
    const document = parseTaskMarkdown(await vault.read(parent.taskFile as never));
    await vault.modify(parent.taskFile as never, renderTaskMarkdown(updateTaskFields(document.record, {
      subtasks: [{ ...action, source_task_id: source.record.task_id }]
    }), document.body));
    await service.refresh();
    await service.convertTaskToSubtask(source.record.task_id, parent.record.task_id);
    expect(service.getById(parent.record.task_id).record.subtasks).toHaveLength(1);
    expect(service.getById(source.record.task_id).record.status).toBe(source.record.status);
  });

  it("restores both parents, attachments and references when archiving after an action move fails", async () => {
    const { service, vault } = createService(); await service.initialize();
    const previous = await service.createTask({ title: "Move rollback previous" });
    const parent = await service.createTask({ title: "Move rollback target" });
    const source = await service.createTask({ title: "Move rollback source" });
    const action = await service.addSubtask(previous.record.task_id, source.record.title);
    const document = parseTaskMarkdown(await vault.read(previous.taskFile as never));
    await vault.modify(previous.taskFile as never, renderTaskMarkdown(updateTaskFields(document.record, {
      subtasks: [{ ...action, source_task_id: source.record.task_id }]
    }), document.body));
    const original = `${service.subtaskFolder(previous.record.task_id, action.id)}/Evidence.md`;
    await vault.create(original, "Keep evidence");
    await service.refresh();
    const before = await vault.read(previous.taskFile as never);
    vault.failNextWriteTarget = source.taskFile.path;
    await expect(service.convertTaskToSubtask(source.record.task_id, parent.record.task_id)).rejects.toThrow();
    expect(await vault.read(previous.taskFile as never)).toBe(before);
    expect(service.getById(parent.record.task_id).record.subtasks).toEqual([]);
    expect(service.getById(source.record.task_id).archived).toBe(false);
    expect(vault.getAbstractFileByPath(original)).not.toBeNull();
  });

  it("blocks ambiguous converted actions without moving either copy", async () => {
    const { service, vault } = createService(); await service.initialize();
    const source = await service.createTask({ title: "Ambiguous source" });
    const parent = await service.createTask({ title: "Ambiguous target" });
    for (const title of ["First existing parent", "Second existing parent"]) {
      const existing = await service.createTask({ title });
      const action = await service.addSubtask(existing.record.task_id, source.record.title);
      const document = parseTaskMarkdown(await vault.read(existing.taskFile as never));
      await vault.modify(existing.taskFile as never, renderTaskMarkdown(updateTaskFields(document.record, { subtasks: [{ ...action, source_task_id: source.record.task_id }] }), document.body));
    }
    await service.refresh();
    await expect(service.convertTaskToSubtask(source.record.task_id, parent.record.task_id)).rejects.toThrow("multiple actions");
    expect(service.getById(parent.record.task_id).record.subtasks).toEqual([]);
    expect(service.getById(source.record.task_id).archived).toBe(false);
  });

  it("rolls conversion back if writing the original fails", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const parent = await service.createTask({ title: "Rollback parent" });
    const source = await service.createTask({ title: "Rollback source" });
    const file = await service.createRelatedNote(source.record.task_id, "Evidence", "Keep me");
    const original = file.path;
    vault.failNextWriteTarget = source.taskFile.path;
    await expect(service.convertTaskToSubtask(source.record.task_id, parent.record.task_id)).rejects.toThrow();
    expect(service.getById(parent.record.task_id).record.subtasks).toHaveLength(0);
    expect(service.getById(source.record.task_id).archived).toBe(false);
    expect(vault.getAbstractFileByPath(original)).not.toBeNull();
  });

  it("rejects self-conversion and unsafe paths, and gives duplicate subtask titles separate destinations", async () => {
    const { service } = createService();
    await service.initialize();
    const parent = await service.createTask({ title: "Guard parent" });
    await expect(service.convertTaskToSubtask(parent.record.task_id, parent.record.task_id)).rejects.toThrow("own parent");
    const one = await service.addSubtask(parent.record.task_id, "Step");
    const two = await service.addSubtask(parent.record.task_id, "Step");
    expect(one.attachment_folder).not.toBe(two.attachment_folder);
    service.getById(parent.record.task_id).record.subtasks[0].attachment_folder = "../escape";
    expect(() => service.subtaskFolder(parent.record.task_id, one.id)).toThrow("Invalid subtask");
  });

  it("restores subtask attachments and removes the new task when promotion fails", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const parent = await service.createTask({ title: "Promotion rollback" });
    const sub = await service.addSubtask(parent.record.task_id, "Promoted action");
    const original = `${service.subtaskFolder(parent.record.task_id, sub.id)}/Evidence.md`;
    await vault.create(original, "Preserve evidence");
    vault.failNextWriteTarget = parent.taskFile.path;
    await expect(service.promoteSubtask(parent.record.task_id, sub.id)).rejects.toThrow();
    expect(service.getById(parent.record.task_id).record.subtasks).toHaveLength(1);
    expect(vault.getAbstractFileByPath(original)).not.toBeNull();
    expect(service.list().filter((task) => task.record.title === "Promoted action")).toHaveLength(0);
  });
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
      archived: false,
      record: {
        task_id: "tsk_confirmed_archive",
        title: "Archive after confirmation",
        status: "completed",
        project: "Basic Needs Expansion"
      }
    });
    expect(archived.record.tags).toContain("project/Basic_Needs_Expansion");
    expect(archived.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Archive after confirmation/task.md");
    expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Tasks/Archive after confirmation/task.md")).not.toBeNull();
    for (const collection of ["Tasks", "Updates", "Files"]) {
      expect(vault.getAbstractFileByPath(`08 Tasks/Inbox/${collection}/Archive after confirmation`)).not.toBeNull();
      expect(vault.getAbstractFileByPath(`08 Tasks/Inbox/${collection}`)).not.toBeNull();
    }
  });

  it("archives a relocated objective in place with its empty folders and neighboring files", async () => {
    const { service, vault } = createService();
    await service.initialize();
    await vault.createFolder("03 Areas");
    await vault.createFolder("03 Areas/Career");
    const task = await service.createTask({ taskId: "tsk_cleanup_bundle", title: "Cleanup bundle" });
    const relocated = await service.relocateTask(task.record.task_id, "03 Areas/Career");
    const source = relocated.folderPath;
    await vault.createFolder(`${source}/Files/Empty`);
    await vault.create(`${source}/Files/evidence.md`, "Keep archived evidence");
    await vault.create("03 Areas/Career/Career Tasks/neighbor.md", "Keep neighbor");
    await service.refresh();

    const archived = await service.changeStatus(task.record.task_id, "archived");

    expect(vault.getAbstractFileByPath(source)).not.toBeNull();
    expect(vault.getAbstractFileByPath("03 Areas/Career/Career Tasks")).not.toBeNull();
    expect(vault.getAbstractFileByPath("03 Areas/Career/Career Tasks/neighbor.md")).not.toBeNull();
    const evidence = vault.getAbstractFileByPath(`${source}/Files/evidence.md`);
    expect(evidence).toBeInstanceOf(obsidianMock.MockTFile);
    expect(await vault.read(evidence as InstanceType<typeof obsidianMock.MockTFile>)).toContain("Keep archived evidence");
    expect(archived.archived).toBe(false);
      expect(archived.record.status).toBe("completed");
  });

  it("preserves source folders with remaining notes and hidden files", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const task = await service.createTask({ taskId: "tsk_cleanup_keep", title: "Keep leftovers" });
    const taskRoot = "08 Tasks/Inbox/Tasks/Keep leftovers";
    const updatesRoot = "08 Tasks/Inbox/Updates/Keep leftovers";
    await vault.create(`${taskRoot}/personal.md`, "Do not remove");
    vault.hiddenFiles.add(`${updatesRoot}/.hidden`);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const archived = await service.changeStatus(task.record.task_id, "archived");
      expect(archived.archived).toBe(false);
      expect(archived.record.status).toBe("completed");
      expect(vault.getAbstractFileByPath(`${taskRoot}/personal.md`)).not.toBeNull();
      expect(vault.getAbstractFileByPath(taskRoot)).not.toBeNull();
      expect(vault.getAbstractFileByPath(updatesRoot)).not.toBeNull();
      expect(vault.hiddenFiles.has(`${updatesRoot}/.hidden`)).toBe(true);
    } finally { warning.mockRestore(); }
  });

  it("rolls history back when an archive record write fails", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const task = await service.createTask({ taskId: "tsk_cleanup_rollback", title: "Failed archive" });
    const originalTaskPath = task.taskFile.path;
    const originalUpdatesPath = task.updatesFile!.path;
    vault.failNextWriteTarget = originalTaskPath;

    await expect(service.changeStatus(task.record.task_id, "archived")).rejects.toThrow();

    expect(vault.getAbstractFileByPath(originalTaskPath)).not.toBeNull();
    expect(vault.getAbstractFileByPath(originalUpdatesPath)).not.toBeNull();
    expect(parseTaskMarkdown(await vault.read(task.taskFile as never)).record.status).not.toBe("archived");
    for (const collection of ["Tasks", "Updates", "Files"]) {
      expect(vault.getAbstractFileByPath(`08 Tasks/Inbox/${collection}/Failed archive`)).not.toBeNull();
    }
  });

  it("keeps a successful archive when an empty source folder cannot be removed", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const task = await service.createTask({ taskId: "tsk_cleanup_locked", title: "Locked source" });
    vault.failRemovePath = "08 Tasks/Inbox/Tasks/Locked source";
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const archived = await service.changeStatus(task.record.task_id, "archived");
      expect(archived.archived).toBe(false);
      expect(archived.record.status).toBe("completed");
      expect(vault.getAbstractFileByPath(vault.failRemovePath)).not.toBeNull();
      expect(vault.getAbstractFileByPath("08 Tasks/Inbox/Updates/Locked source")).not.toBeNull();
    } finally { warning.mockRestore(); }
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

  it("separates objective files from each action's files while preserving explicit external links", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const task = await service.createTask({
      taskId: "tsk_owned_file_sets",
      title: "Keep attachment ownership",
      status: "do-first"
    });
    const first = await service.addSubtask(task.record.task_id, "First action");
    const second = await service.addSubtask(task.record.task_id, "Second action");
    const objectiveFolder = (await service.ensureFilesFolderForTask(task.record.task_id)).folderPath;
    const objectiveFile = await vault.create(`${objectiveFolder}/Objective evidence.md`, "Objective-owned file");
    const firstFile = await vault.create(`${service.subtaskFolder(task.record.task_id, first.id)}/First evidence.md`, "First action only");
    const secondFile = await vault.create(`${service.subtaskFolder(task.record.task_id, second.id)}/Second evidence.md`, "Second action only");
    await vault.createFolder("04 Resources");
    const explicitExternal = await vault.create("04 Resources/Shared guidance.md", "Intentional cross-link");
    const current = service.getById(task.record.task_id);
    const document = parseTaskMarkdown(await vault.read(current.taskFile as never));
    await vault.modify(current.taskFile as never, renderTaskMarkdown(updateTaskFields(document.record, {
      related_files: [explicitExternal.path, firstFile.path]
    }), document.body));

    await service.refresh();

    expect(service.objectiveFiles(task.record.task_id).map((related) => related.file.path).sort()).toEqual([
      explicitExternal.path,
      objectiveFile.path
    ].sort());
    expect(service.subtaskFiles(task.record.task_id, first.id).map((file) => file.path)).toEqual([firstFile.path]);
    expect(service.subtaskFiles(task.record.task_id, second.id).map((file) => file.path)).toEqual([secondFile.path]);
    expect(service.objectiveFiles(task.record.task_id).map((related) => related.file.path)).not.toContain(firstFile.path);
    expect(service.objectiveFiles(task.record.task_id).map((related) => related.file.path)).not.toContain(secondFile.path);
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

  it("creates captured objectives directly in Program and Area folders with their workspace and metadata intact", async () => {
    const { service, vault } = createService(); await service.initialize();
    for (const destination of ["02 Programs/CalWORKs", "03 Areas/Career"]) {
      await vault.createFolder(destination);
      const created = await service.createTask({ title: "Capture in chosen folder", destination, details: "Preserve context", people: ["Franklin"], project: "Existing project", due: "2026-11-01", status: "waiting", source: { type: "manual", title: "Capture reference", url: "" } });
      const root = destination + (destination.startsWith("02") ? "/CalWORKs Tasks" : "/Career Tasks") + "/Capture in chosen folder";
      expect(created.taskFile.path).toBe(`${root}/task.md`);
      expect(created.updatesFile?.path).toBe(`${root}/updates.md`);
      expect(await vault.adapter.stat(`${root}/Files`)).toEqual({ type: "folder" });
      expect(created.record).toMatchObject({ people: ["Franklin"], project: "Existing project", agenda_selected: true, due: "2026-11-01", status: "waiting", source_title: "Capture reference", location: root });
      expect(created.notes).toContain("Preserve context");
      expect(await vault.read(created.updatesFile as never)).toContain("Task workspace created.");
      expect(vault.getFiles().filter((file) => file.path.startsWith("08 Tasks/Inbox/") && file.content.includes(created.record.task_id))).toEqual([]);
    }
    expect(service.list()).toHaveLength(2);
  });

  it("keeps the default Inbox destination and assigns separate folders to repeated selected-folder titles", async () => {
    const { service, vault } = createService(); await service.initialize();
    const defaultTask = await service.createTask({ title: "Default capture", destination: "" });
    expect(defaultTask.taskFile.path).toBe("08 Tasks/Inbox/Tasks/Default capture/task.md");
    await vault.createFolder("02 Programs/Foundation");
    const first = await service.createTask({ title: "Same name", destination: "02 Programs/Foundation" });
    await service.createRelatedNote(first.record.task_id, "Evidence", "Preserve first attachment");
    const second = await service.createTask({ title: "Same name", destination: "02 Programs/Foundation" });
    expect(second.taskFile.path).toBe("02 Programs/Foundation/Foundation Tasks/Same name (2)/task.md");
    expect(first.record.task_id).not.toBe(second.record.task_id);
    expect(service.getById(first.record.task_id).relatedFiles[0].preview).toContain("Preserve first attachment");
  });

  it("rejects unavailable or disallowed capture folders before writing objective records", async () => {
    const { service, vault } = createService(); await service.initialize();
    await vault.createFolder("02 Programs/.hidden");
    const before = vault.getFiles().map((file) => file.path);
    for (const destination of ["08 Tasks/Other", "02 Programs", "02 Programs/Missing", "02 Programs/.hidden", "02 Programs/../../Other"]) {
      await expect(service.createTask({ title: "Invalid destination", destination })).rejects.toThrow();
    }
    expect(vault.getFiles().map((file) => file.path)).toEqual(before);
    expect(service.list()).toEqual([]);
  });

  it("cleans up a capture when attachment-folder creation fails and supports a destination named Tasks", async () => {
    const { service, vault } = createService(); await service.initialize();
    const destination = "03 Areas/Career/Tasks";
    await vault.createFolder(destination);
    vault.failNextFolderTarget = `${destination}/Objective Tasks/New objective/Files`;
    await expect(service.createTask({ title: "New objective", destination })).rejects.toThrow("folder failure");
    expect(await vault.adapter.stat(`${destination}/Objective Tasks/New objective`)).toBeNull();
    expect(service.list()).toEqual([]);
    const created = await service.createTask({ title: "New objective", destination });
    expect(created.relocatedBundle).toBe(true);
    expect(created.updatesFile?.path).toBe(`${destination}/Objective Tasks/New objective/updates.md`);
  });

  it.each([undefined, "02 Programs/Foundation"])("removes complete captured workspaces after batch failure, with first destination %s", async (destination) => {
    const { service, vault } = createService(); await service.initialize();
    await vault.createFolder("02 Programs/Foundation"); await vault.createFolder("03 Areas/Career");
    vault.failNextWriteTarget = "03 Areas/Career/Career Tasks/Failed capture/updates.md";
    await expect(service.createTasks([
      { title: "First capture", destination },
      { title: "Failed capture", destination: "03 Areas/Career" }
    ])).rejects.toThrow("rolled back");
    expect(service.list()).toEqual([]);
    expect(vault.getFiles().filter((file) => /First capture|Failed capture/.test(file.path))).toEqual([]);
    expect(await vault.adapter.stat("03 Areas/Career/Career Tasks/Failed capture")).toBeNull();
    if (destination) expect(await vault.adapter.stat("02 Programs/Foundation/Foundation Tasks/First capture")).toBeNull();
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
      .toContain("_No non-archived objectives are currently indexed._");
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
    expect(markdown).toMatch(/### \[\[.*Prepare weekly enrollment report\]\][\s\S]*\*\*Status:\*\* Waiting[\s\S]*\*\*Project:\*\* #project\/Enrollment/);
    expect(markdown).toMatch(/### \[\[.*Review unassigned follow-up\]\][\s\S]*\*\*Status:\*\* Do First/);
    expect(markdown).toContain("**Due:** Aug 21, 2026");
    expect(markdown).toContain("**Delegated:** Dara");
    expect(markdown).toContain("Confirm the MIS totals with PRIE.");
    expect(markdown).toContain("PRIE sent the corrected enrollment extract.");
    expect(markdown).not.toContain("Objectives and projects");
    expect(markdown).not.toContain("Project tag status");
    expect(markdown).toContain("generated_at: 2026-08-16T20:00:00.000Z");
  });

  it("surfaces an explicit briefing write failure to the open-note action", async () => {
    const { service, vault } = createService();
    await service.initialize();
    vault.failNextWriteTarget = service.briefingPath();

    await expect(service.refreshBriefingNote()).rejects.toThrow("Simulated write failure");
  });
});

describe("People persistence and agenda publication",()=>{
  it("persists associations without moving or retagging and replaces the export on deselection or completion",async()=>{
    const {service,vault}=createService();
    await vault.createFolder("05 People/Agenda Items");
    await vault.create("05 People/Agenda Items/_roster.json",JSON.stringify({members:["Leyla Recinos","Dr. Carter","CalWORKs Team"]}));
    await service.initialize();
    const task=await service.createTask({title:"People acceptance",project:"Existing project",details:"Keep notes and existing tags."});
    const original=await vault.read(task.taskFile as never); const originalRecord=parseTaskMarkdown(original).record;
    expect(service.peopleNames()).toEqual(["Dr. Carter","Leyla Recinos"]);
    await service.changePeople(task.record.task_id,["Leyla Recinos"],false);
    await service.refresh();
    expect(service.getById(task.record.task_id).record.people).toEqual(["Leyla Recinos"]);
    expect(service.getById(task.record.task_id).record.agenda_selected).toBe(false);
    const unselectedExport = JSON.parse((vault.getAbstractFileByPath("05 People/Agenda Items/_objectives.json") as InstanceType<typeof obsidianMock.MockTFile>).content);
    expect(unselectedExport.objectives).toEqual([]);
    await service.changePeople(task.record.task_id,["Leyla Recinos","Dr. Carter"],true);
    const saved=service.getById(task.record.task_id);
    expect(saved.taskFile.path).toBe(task.taskFile.path);expect(saved.record.tags).toEqual(originalRecord.tags);expect(saved.record.project).toBe(originalRecord.project);
    const snapshot=()=>JSON.parse((vault.getAbstractFileByPath("05 People/Agenda Items/_objectives.json") as InstanceType<typeof obsidianMock.MockTFile>).content);
    expect(snapshot().objectives[0].people).toEqual(["Leyla Recinos","Dr. Carter"]);
    await service.refresh();expect(service.getById(task.record.task_id).record.agenda_selected).toBe(true);
    await service.changePeople(task.record.task_id,["Leyla Recinos"],false);expect(snapshot().objectives).toEqual([]);
    await service.changePeople(task.record.task_id,["Leyla Recinos"],true);
    await service.changeStatus(task.record.task_id,"completed");expect(snapshot().objectives).toEqual([]);
  });
});

it("persists browser People through protocol normalization, workspace creation and refresh", async () => {
 const {service,vault}=createService();
 await service.initialize();
 const payload=normalizeProtocolPayload({version:2,action:"create-task-note",title:"People capture",details:"Keep these details",status:"Waiting",people:["Alex Rivera","Sam Lee"],tags:["task"],source:{title:"Source",url:"https://example.com",sourceKind:"web"}});
 if(payload.action!=="create-tasks") throw new Error("Unexpected payload");
 const task=await service.createFromClip(payload.items[0],payload.request_id,payload.created_at);
 await service.refresh();
 const saved=parseTaskMarkdown(await vault.read(task.taskFile as never));
 expect(saved.record.people).toEqual(["Alex Rivera","Sam Lee"]);
 expect(saved.record.project).toBe("");
 expect(saved.record.status).toBe("waiting");
 expect(saved.record.agenda_selected).toBe(true);
 expect(saved.body).toContain("Keep these details");
 expect(service.getById(task.record.task_id).record.people).toEqual(["Alex Rivera","Sam Lee"]);
});

it("defaults first People assignment on without changing existing opt-outs or untouched legacy files", async () => {
  const {service,vault}=createService();
  await vault.createFolder("05 People/Agenda Items");
  await service.initialize();
  const fresh=await service.createTask({title:"New default"});
  expect(fresh.record.agenda_selected).toBe(true);
  await service.changePeople(fresh.record.task_id,["Leyla Recinos"]);
  expect(service.getById(fresh.record.task_id).record.agenda_selected).toBe(true);
  await service.changePeople(fresh.record.task_id,["Leyla Recinos"],false);
  await service.refresh();
  await service.changePeople(fresh.record.task_id,["Leyla Recinos","Dr. Carter"]);
  expect(service.getById(fresh.record.task_id).record.agenda_selected).toBe(false);
  await service.changePeople(fresh.record.task_id,[]);
  await service.changePeople(fresh.record.task_id,["Leyla Recinos"]);
  expect(service.getById(fresh.record.task_id).record.agenda_selected).toBe(false);
  const legacy=await service.createTask({title:"Legacy empty"});
  const markdown=(await vault.read(legacy.taskFile as never)).replace("agenda_selected: true","agenda_selected: false");
  await vault.modify(legacy.taskFile as never,markdown);
  await service.refresh();
  expect(await vault.read(legacy.taskFile as never)).toBe(markdown);
  await service.changePeople(legacy.record.task_id,[]);
  expect(service.getById(legacy.record.task_id).record.agenda_selected).toBe(false);
  await service.changePeople(legacy.record.task_id,["Leyla Recinos"]);
  expect(service.getById(legacy.record.task_id).record.agenda_selected).toBe(true);
  const associated=await service.createTask({title:"Legacy associated",people:["Leyla Recinos"]});
  const old=(await vault.read(associated.taskFile as never)).replace("agenda_selected: true","agenda_selected: false");
  await vault.modify(associated.taskFile as never,old); await service.refresh();
  await service.changePeople(associated.record.task_id,["Leyla Recinos","Dr. Carter"]);
  expect(service.getById(associated.record.task_id).record.agenda_selected).toBe(false);
});


describe("objective discovery and duplicate safety", () => {
  it("keeps active copies visible regardless of discovery order and blocks ambiguous edits", async () => {
    for (const archiveFirst of [true, false]) {
      const { service, vault } = createService();
      const record = createTaskRecord({ taskId: "tsk_duplicate_safety", title: "Preserve both", status: "on-hold" });
      const paths = ["08 Tasks/Archive/Preserve both/task.md", "08 Tasks/Inbox/Files/Preserve both/task.md"];
      if (!archiveFirst) paths.reverse();
      for (const path of paths) await vault.create(path, renderTaskMarkdown(record, path));
      await service.refresh();
      expect(service.list()).toHaveLength(1);
      expect(service.list()[0].taskFile.path).toContain("Inbox/Files");
      await expect(service.changeStatus(record.task_id, "completed")).rejects.toThrow("conflicting copies");
      for (const path of paths) expect(await vault.read(vault.getAbstractFileByPath(path) as never)).toContain(path);
    }
  });

  it("indexes Files bundles and preserves identity and attachments through repeated archive/reopen", async () => {
    const { service, vault } = createService();
    await service.initialize();
    const record = createTaskRecord({ taskId: "tsk_files_cycles", title: "Recovered objective", status: "inbox" });
    const root = "08 Tasks/Inbox/Files/Recovered objective";
    await vault.create(`${root}/task.md`, renderTaskMarkdown(record, "Source-backed recovery notes"));
    await vault.create(`${root}/updates.md`, renderUpdatesMarkdown());
    await vault.createFolder(`${root}/Files`);
    await vault.create(`${root}/Files/evidence.txt`, "Unique evidence");
    await service.refresh();
    expect(service.getById(record.task_id).record.status).toBe("inbox");
    for (let cycle = 0; cycle < 2; cycle++) {
      await service.changeStatus(record.task_id, "archived");
      await service.changeStatus(record.task_id, "inbox");
      expect(service.list({ includeArchived: true }).filter(t => t.record.task_id === record.task_id)).toHaveLength(1);
      expect(vault.getFiles().filter(f => f.name === "task.md")).toHaveLength(1);
      expect(vault.getFiles().filter(f => f.content === "Unique evidence")).toHaveLength(1);
    }
  });
});


it("reserves explicit objective IDs across overlapping creation requests", async () => {
  const { service, vault } = createService(); await service.initialize();
  const results = await Promise.allSettled([
    service.createTask({ taskId: "tsk_concurrent_id", title: "First copy" }),
    service.createTask({ taskId: "tsk_concurrent_id", title: "Second copy" })
  ]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  expect(vault.getFiles().filter(f => f.name === "task.md")).toHaveLength(1);
});


it("archives and restores in place repeatedly, serializes competing requests, and preserves unknown metadata and hidden/shared/nested files", async () => {
  const {service,vault}=createService(); await service.initialize();
  const task=await service.createTask({taskId:"tsk_status_cycles", title:"Status cycles",status:"waiting"});
  const path=task.taskFile.path, history=task.updatesFile!.path;
  const original=await vault.read(task.taskFile as never);
  await vault.modify(task.taskFile as never,original.replace("schema_version:","custom_metadata: {important: true}\nschema_version:"));
  const files=["08 Tasks/Inbox/Files/Status cycles/nested/deep/evidence.bin","08 Tasks/Inbox/Files/Status cycles/.private","Shared/reference.md"];
  for(const f of files) await vault.create(f,`bytes:${f}`);
  vault.hiddenFiles.add("08 Tasks/Inbox/Files/Status cycles/.hidden-dir/secret");
  await service.refresh();
  for(let cycle=0;cycle<3;cycle++) {
    await Promise.all([service.changeStatus(task.record.task_id,"archived"), service.changeStatus(task.record.task_id,"archived")]);
    expect(service.list().find(t=>t.record.task_id===task.record.task_id)?.record.status).toBe("completed");
    expect(service.getById(task.record.task_id).record.completed_from_status).toBe("waiting");
    await service.restoreTask(task.record.task_id);
    expect(service.getById(task.record.task_id).record.status).toBe("waiting");
    expect(service.getById(task.record.task_id).taskFile.path).toBe(path);
    expect(service.getById(task.record.task_id).updatesFile!.path).toBe(history);
    for(const f of files) expect((vault.getAbstractFileByPath(f) as any).content).toBe(`bytes:${f}`);
  }
  expect(await vault.read(task.taskFile as never)).toContain("custom_metadata:");
  expect((await vault.read(task.updatesFile as never)).match(/Status changed from waiting to completed/g)).toHaveLength(3);
  expect(vault.hiddenFiles.size).toBe(1);
});

it("restores legacy archived records to Inbox when previous status is unknown, without relocating",async()=>{
  const {service,vault}=createService(); await service.initialize();
  const record=createTaskRecord({taskId:"tsk_old_archived",title:"Old archive",status:"archived"});
  const path="08 Tasks/Archive/Old archive/task.md";
  await vault.create(path,renderTaskMarkdown(record)); await service.refresh();
  const restored=await service.restoreTask(record.task_id);
  expect(restored.record.status).toBe("inbox");expect(restored.taskFile.path).toBe(path);expect(restored.archived).toBe(false);
});

it("restores a known legacy status from history and preserves completed timestamps through archive",async()=>{
  const {service,vault}=createService();await service.initialize();
  const task=await service.createTask({taskId:"tsk_completed_restore",title:"Completed restore",status:"completed"});
  const completed=task.record.completed_at;
  await service.changeStatus(task.record.task_id,"archived");
  const restored=await service.restoreTask(task.record.task_id);
  expect(restored.record.status).toBe("inbox");expect(restored.record.completed_at).toBe("");expect(completed).toBeTruthy();
  const record=createTaskRecord({taskId:"tsk_history_restore",title:"History restore",status:"archived"});
  const root="08 Tasks/Archive/History restore";
  await vault.create(root+"/task.md",renderTaskMarkdown(record));
  await vault.create(root+"/updates.md","# Updates\n\n### 2026-01-02 09:00 — Franklin\n\n- Type: `archived`\n- Status: `waiting` → `archived`\n\nArchived.\n");
  await service.refresh();expect((await service.restoreTask(record.task_id)).record.status).toBe("waiting");
});

 it("exposes legacy archived records as Completed and preserves Inbox exceptions on refresh", async()=>{
 const {service,vault}=createService(); await service.initialize();
 for(let n=0;n<18;n++){const record=createTaskRecord({taskId:`tsk_inbox_exception_${n}`,title:`Exception ${n}`,status:"inbox"}); await vault.create(`08 Tasks/Inbox/Files/Exception ${n}/task.md`,renderTaskMarkdown(record));}
 const record=createTaskRecord({taskId:"tsk_legacy_completed_visibility",title:"Legacy completed",status:"archived"});
 const path="08 Tasks/Archive/Legacy/task.md"; const original=renderTaskMarkdown(record);await vault.create(path,original);await service.refresh();
 expect(service.list().filter(t=>t.record.status==="inbox")).toHaveLength(18);
 expect(service.getById(record.task_id).record.status).toBe("completed");
 expect(service.getById(record.task_id).archived).toBe(false);
 expect(await vault.read(vault.getAbstractFileByPath(path) as never)).toBe(original);
 });

it("rolls history back after an interrupted completion write and permits a clean retry",async()=>{
 const {service,vault}=createService();await service.initialize();
 const task=await service.createTask({taskId:"tsk_completion_interruption",title:"Interrupted completion",status:"waiting"});
 const beforeTask=await vault.read(task.taskFile as never),beforeHistory=await vault.read(task.updatesFile as never);
 vault.failNextWriteTarget=task.taskFile.path;
 await expect(service.changeStatus(task.record.task_id,"completed")).rejects.toThrow("Simulated write failure");
 expect(await vault.read(task.taskFile as never)).toBe(beforeTask);
 expect(await vault.read(task.updatesFile as never)).toBe(beforeHistory);
 await service.changeStatus(task.record.task_id,"completed");
 expect(service.getById(task.record.task_id).record.status).toBe("completed");
 expect(service.getById(task.record.task_id).taskFile.path).toBe(task.taskFile.path);
 await service.restoreTask(task.record.task_id);
 expect(service.getById(task.record.task_id).record.status).toBe("waiting");
});


it.each([undefined, "02 Programs/QA Fixture"])("creation waits for a superseding scan with destination %s", async (destination) => {
  const {service,vault}=createService(); await service.initialize();
  await service.createTask({title:"Existing scan anchor"});
  if(destination) await vault.createFolder(destination);
  const original=vault.cachedRead.bind(vault);
  let trigger=true, blockOnce=true, settled=false;
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  let newer:Promise<void>|undefined;
  vault.cachedRead=async(file) => {
    if(trigger) {trigger=false; newer=service.refresh();}
    else if(blockOnce) {blockOnce=false; await gate;}
    return original(file);
  };
  const creating=service.createTasks([{title:"Create during scan", people:["Fixture Person"],agendaSelected:false,destination}, {title:"Batch second objective",agendaSelected:false,destination}]);
  void creating.then(()=>settled=true,()=>settled=true);
  await new Promise(resolve=>setTimeout(resolve,20));
  const returnedBeforeLatestScan=settled;
  release();
  const results=await creating;
  await newer;
  expect(returnedBeforeLatestScan).toBe(false);
  expect(results).toHaveLength(2);
  expect(service.getById(results[0].record.task_id).record.people).toEqual(["Fixture Person"]);
  expect(vault.getFiles().filter(f=>f.name==="task.md")).toHaveLength(3);
});


it("filters Completed by saved status across refreshes without rewriting source records", async () => {
  const { service, vault } = createService();
  await service.initialize();
  const fixtures = [
    { title: "Saved Archived", status: "archived", legacy_archive_status: "" },
    { title: "Saved Completed", status: "completed", legacy_archive_status: "" },
    { title: "Completed with history", status: "completed", legacy_archive_status: "archived" },
    { title: "Open with history", status: "waiting", legacy_archive_status: "archived" }
  ] as const;
  const sources: { id: string; path: string; text: string }[] = [];
  for (const [i, fixture] of fixtures.entries()) {
    const record = { ...createTaskRecord({ taskId: `tsk_saved_status_${i}`, title: fixture.title, status: fixture.status }),
      legacy_archive_status: fixture.legacy_archive_status, legacy_archived_at: "2026-10-01T00:00:00Z" };
    const path = `08 Tasks/Archive/Fixture ${i}/task.md`;
    const text = renderTaskMarkdown(record);
    await vault.create(path, text);
    sources.push({ id: record.task_id, path, text });
  }
  for (let scan = 0; scan < 2; scan++) {
    await service.refresh();
    const tasks = sources.map(source => service.getById(source.id));
    expect(tasks.map(task => matchesHomeScope(task.record, "completed"))).toEqual([false, true, true, false]);
    expect(tasks.map(task => taskMatchesView(task.record, "completed"))).toEqual([false, true, true, false]);
    expect(countTasksForView(tasks.map(task => task.record), "completed")).toBe(2);
    expect(filterHomeTasks(tasks, "completed", "Saved Archived", "", "", "updated")).toEqual([]);
    expect(filterHomeTasks(tasks, "completed", "", "", "", "updated")).toHaveLength(2);
    for (const source of sources) expect(await vault.read(vault.getAbstractFileByPath(source.path) as never)).toBe(source.text);
    expect(renderTaskMarkdown(tasks[0].record)).not.toContain("__fjgSourceArchived");
  }
  // Explicit completion must clear the derived archive-origin marker on the next scan.
  await service.changeStatus(sources[0].id, "completed");
  const completed = service.getById(sources[0].id);
  expect(completed.taskFile.path).toBe(sources[0].path);
  expect(matchesHomeScope(completed.record, "completed")).toBe(true);
  expect(taskMatchesView(completed.record, "completed")).toBe(true);
});

it("updates Inbox folder membership after creation and relocation without changing metadata or files", async () => {
  const {service,vault}=createService(); await service.initialize();
  await vault.createFolder("02 Programs/Veterans");
  const inside=await service.createTask({title:"Inbox location fixture",status:"waiting"});
  const matches=(id:string) => { const t=service.getById(id); return taskMatchesView(t.record,"no-project",undefined,t.statusAssigned,t.taskFile.path); };
  expect(matches(inside.record.task_id)).toBe(true);
  const note=await service.createRelatedNote(inside.record.task_id,"Evidence","Retain attachment bytes");
  const original=await vault.read(note as never);
  const moved=await service.relocateTask(inside.record.task_id,"02 Programs/Veterans");
  expect(matches(inside.record.task_id)).toBe(false);
  expect(moved.record.status).toBe("waiting");
  expect(moved.record.task_id).toBe(inside.record.task_id);
  expect(moved.record.tags).toEqual(inside.record.tags);
  expect(await vault.read(vault.getAbstractFileByPath(moved.record.related_files[0]) as never)).toBe(original);
  expect(taskMatchesView(moved.record,"all-open",undefined,true,moved.taskFile.path)).toBe(true);
  const filed=await service.createTask({title:"Chosen destination fixture",destination:"02 Programs/Veterans",status:"inbox"});
  expect(matches(filed.record.task_id)).toBe(false);
  expect(taskMatchesView(filed.record,"inbox",undefined,true,filed.taskFile.path)).toBe(true);
});

it("keeps Completed state and attachments when moving an Inbox folder objective to a Program", async () => {
 const {service,vault}=createService();await service.initialize();await vault.createFolder("02 Programs/Delete QA");
 const task=await service.createTask({title:"Completed move fixture",status:"completed"});
 const file=await service.createRelatedNote(task.record.task_id,"Evidence","Keep completed evidence");
 const originalBytes=await vault.read(file as never);
 expect(taskMatchesView(task.record,"no-project",undefined,true,task.taskFile.path)).toBe(true);
 const moved=await service.relocateTask(task.record.task_id,"02 Programs/Delete QA");
 expect(moved.record.status).toBe("completed");expect(moved.record.task_id).toBe(task.record.task_id);
 expect(taskMatchesView(moved.record,"no-project",undefined,true,moved.taskFile.path)).toBe(false);
 expect(taskMatchesView(moved.record,"completed",undefined,true,moved.taskFile.path)).toBe(true);
 expect(await vault.read(vault.getAbstractFileByPath(moved.record.related_files[0]) as never)).toBe(originalBytes);
});


describe("converted original identity",()=>{
 it("retains open source state and durable IDs, excludes Completed, and is repeat-safe",async()=>{
  const {service,vault}=createService();await service.initialize();
  const source=await service.createTask({title:"Converted fixture",status:"waiting",details:"Source notes"});
  const parent=await service.createTask({title:"Parent fixture"});
  await service.appendUpdate(source.record.task_id,{actor:"Test",text:"Preserved update"});
  const history=await vault.read(source.updatesFile as never);
  await service.createRelatedNote(source.record.task_id,"Proof","exact evidence");
  for(const task of [source,parent]){const content=await vault.read(task.taskFile as never);await vault.modify(task.taskFile as never,content.replace("---\n","---\ncustom_conversion_evidence: preserve-me # user comment\n"));}
  await service.refresh();
  const first=service.convertTaskToSubtask(source.record.task_id,parent.record.task_id);
  await expect(service.convertTaskToSubtask(source.record.task_id,parent.record.task_id)).rejects.toThrow("progress");await first;
  const original=service.getById(source.record.task_id),action=service.getById(parent.record.task_id).record.subtasks[0];
  expect(original.record.status).toBe("waiting");expect(original.record.completed_at).toBe("");
  expect(original.record.converted_to).toMatchObject({parent_task_id:parent.record.task_id,action_id:action.id});
  expect(await vault.read(source.updatesFile as never)).toBe(history);
  expect(action).toMatchObject({status:"waiting",completed:false,source_task_id:source.record.task_id});
  expect(action.history).toBe(history);expect(action.notes).toContain("Source notes");
  expect(await vault.read(service.subtaskFiles(parent.record.task_id,action.id)[0] as never)).toContain("exact evidence");
  expect(taskMatchesView(original.record,"completed")).toBe(false);expect(matchesHomeScope(original.record,"completed")).toBe(false);
  expect(taskMatchesView(original.record,"converted")).toBe(true);expect(matchesHomeScope(original.record,"all")).toBe(true);
  await service.convertTaskToSubtask(source.record.task_id,parent.record.task_id);
  expect(service.getById(parent.record.task_id).record.subtasks).toEqual([action]);
  const saved=await vault.read(source.taskFile as never);expect(saved).toContain("converted_to:");expect(saved).not.toContain("__fjgConversionLinks");
  expect(saved).toContain("custom_conversion_evidence: preserve-me # user comment");
  expect(await vault.read(parent.taskFile as never)).toContain("custom_conversion_evidence: preserve-me # user comment");
 });
 it("recognizes historical ID backlinks without writing originals or matching titles",async()=>{
  const {service,vault}=createService();await service.initialize();
  const source=await service.createTask({title:"Same title",status:"completed"});
  const ordinary=await service.createTask({title:"Same title",status:"completed"});
  const parent=await service.createTask({title:"Historical parent"});const a=await service.addSubtask(parent.record.task_id,"Different action title");
  const doc=parseTaskMarkdown(await vault.read(parent.taskFile as never));
  await vault.modify(parent.taskFile as never,renderTaskMarkdown(updateTaskFields(doc.record,{subtasks:[{...a,source_task_id:source.record.task_id,status:"do-soon",completed:false}]}),doc.body));
  const before=await vault.read(source.taskFile as never);await service.refresh();
  expect(await vault.read(source.taskFile as never)).toBe(before);
  expect(taskMatchesView(service.getById(source.record.task_id).record,"completed")).toBe(false);
  expect(taskMatchesView(service.getById(source.record.task_id).record,"converted")).toBe(true);
  expect(taskMatchesView(service.getById(ordinary.record.task_id).record,"completed")).toBe(true);
  expect(matchesHomeScope(service.getById(ordinary.record.task_id).record,"completed")).toBe(true);
 });
 it("retains a missing-parent marker and blocks recreation rather than duplicating an action",async()=>{
  const {service,vault}=createService();await service.initialize();const source=await service.createTask({title:"Orphan provenance"});const parent=await service.createTask({title:"New parent"});
  const doc=parseTaskMarkdown(await vault.read(source.taskFile as never));await vault.modify(source.taskFile as never,renderTaskMarkdown({...doc.record,converted_to:{parent_task_id:"missing",action_id:"missing",converted_at:"2026-10-29T00:00:00Z"}},doc.body));await service.refresh();
  expect(taskMatchesView(service.getById(source.record.task_id).record,"converted")).toBe(true);
  await expect(service.convertTaskToSubtask(source.record.task_id,parent.record.task_id)).rejects.toThrow("unavailable");
  expect(service.getById(parent.record.task_id).record.subtasks).toHaveLength(0);
 });
});


it("coalesces concurrent refresh requests without overlapping scans or stale completion",async()=>{
 const {service,vault}=createService();await service.initialize();await service.createTask({title:"Refresh fixture"});
 const original=vault.cachedRead.bind(vault);let active=0,max=0,release!:()=>void,block=true;
 const gate=new Promise<void>(r=>release=r);
 vault.cachedRead=async file=>{active++;max=Math.max(max,active);try{if(block){block=false;await gate;}return await original(file);}finally{active--;}};
 const first=service.refresh();await new Promise(r=>setTimeout(r,0));
 const requests=Array.from({length:15},()=>service.refresh());
 expect(requests.every(p=>p===first)).toBe(true);release();await Promise.all([first,...requests]);
 expect(max).toBe(1);expect(service.list().some(t=>t.record.title==="Refresh fixture")).toBe(true);
 await service.refresh();expect(max).toBe(1);
});
it("allows refresh retry after a failed scan",async()=>{
 const {service}=createService();await service.initialize();
 const scan=vi.spyOn(service as any,"scanWorkspace").mockRejectedValueOnce(new Error("fixture scan failure"));
 await expect(service.refresh()).rejects.toThrow("fixture scan failure");await service.refresh();expect(scan).toHaveBeenCalledTimes(2);
});

it("managed Move preserves custom metadata and uses current-text reference updates",async()=>{
 const {service,vault,app}=createService();await service.initialize();await vault.createFolder("02 Programs/QA Fixture");
 const task=await service.createTask({title:"Move custom metadata",status:"completed"});
 const raw=await vault.read(task.taskFile as never);await vault.modify(task.taskFile as never,raw.replace("---\n","---\ncustom_move_field: preserve # user comment\n"));
 const rename=vi.spyOn(vault,"rename");await service.refresh();
 const moved=await service.relocateTask(task.record.task_id,"02 Programs/QA Fixture");
 expect(await vault.read(moved.taskFile as never)).toContain("custom_move_field: preserve # user comment");
 expect(moved.record.status).toBe("completed");expect(rename).toHaveBeenCalled();
});
it("rolls back Move metadata and folders after a reference processing failure",async()=>{
 const {service,vault}=createService();await service.initialize();await vault.createFolder("02 Programs/QA Fixture");
 const task=await service.createTask({title:"Rollback reference fixture"});const path=task.taskFile.path,raw=await vault.read(task.taskFile as never);
 const process=vault.process.bind(vault);let n=0;
 vi.spyOn(vault,"process").mockImplementation(async(file,fn)=>{if(++n===3)throw Error("Reference processing unavailable");return process(file,fn);});
 await expect(service.relocateTask(task.record.task_id,"02 Programs/QA Fixture")).rejects.toThrow("Reference processing unavailable");
 expect(service.getById(task.record.task_id).taskFile.path).toBe(path);expect(await vault.read(task.taskFile as never)).toBe(raw);
});
it("does not overwrite a concurrent edit when Move rollback needs attention",async()=>{
 const {service,vault}=createService();await service.initialize();await vault.createFolder("02 Programs/QA Fixture");
 const task=await service.createTask({title:"Concurrent rollback fixture"});const process=vault.process.bind(vault);let n=0;
 vi.spyOn(vault,"process").mockImplementation(async(file,fn)=>{if(++n===3){await vault.modify(task.taskFile as never,(await vault.read(task.taskFile as never))+"\nConcurrent user content\n");throw Error("Injected failure");}return process(file,fn);});
 await expect(service.relocateTask(task.record.task_id,"02 Programs/QA Fixture")).rejects.toThrow("rollback needs attention");
 expect(await vault.read(task.taskFile as never)).toContain("Concurrent user content");
});
