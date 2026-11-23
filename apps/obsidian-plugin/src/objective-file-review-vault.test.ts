import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, vi, afterEach } from "vitest";
import { createTaskRecord, renderTaskMarkdown } from "@fjg/task-core";
import { App, FileSystemAdapter, Platform, TFile, TFolder } from "obsidian";
import type { TaskManagerSettings } from "./settings";
import type { IndexedTask, TaskWorkspaceService } from "./workspace-service";
import { ObjectiveFileReviewService } from "./objective-file-review";
import { isReviewStorePath, VaultObjectiveReviewWorkspace } from "./objective-file-review-vault";

vi.mock("obsidian", () => {
  class TFile {
    name: string; extension: string;
    stat: { size: number; ctime: number; mtime: number };
    constructor(public path: string, public parent: TFolder, size: number) {
      this.name = path.split("/").at(-1)!;
      this.extension = this.name.split(".").at(-1)!;
      this.stat = { size, ctime: 1, mtime: 1 };
    }
  }
  class TFolder {
    children: Array<TFile | TFolder> = [];
    name: string;
    constructor(public path: string, public parent: TFolder | null) { this.name = path.split("/").at(-1)!; }
  }
  class FileSystemAdapter {
    constructor(private readonly base: string) {}
    getBasePath() { return this.base; }
  }
  return { App: class {}, TFile, TFolder, FileSystemAdapter, Platform: { isDesktopApp: false } };
});

type NewFolder = new (path: string, parent: TFolder | null) => TFolder;
type NewFile = new (path: string, parent: TFolder, size: number) => TFile;
const fileRoot = "Fixture/Inbox/Files/Example";
const root = "Fixture/Inbox";
const target = { id: "tsk_synthetic", observedPath: root + "/Tasks/Example/task.md" };

function fixture(adapter?: FileSystemAdapter) {
  const entries = new Map<string, TFolder | TFile>();
  const bytes = new Map<string, string>();
  const indexed = new Map<string, IndexedTask>();
  const allowed = new Map<string, string>();
  const encoder = new TextEncoder();
  const added: string[] = [];
  const folder = (name: string): TFolder => {
    const existing = entries.get(name);
    if (existing instanceof TFolder) return existing;
    const parent = name.includes("/") ? folder(name.slice(0,name.lastIndexOf("/"))) : null;
    const created = new (TFolder as unknown as NewFolder)(name, parent);
    entries.set(name, created);
    parent?.children.push(created);
    return created;
  };
  const file = (name: string, body: string): TFile => {
    const parent = folder(name.slice(0, name.lastIndexOf("/")));
    const created = new (TFile as unknown as NewFile)(name, parent, encoder.encode(body).length);
    entries.set(name, created); parent.children.push(created); bytes.set(name, body);
    return created;
  };
  const task = (id: string, path: string, files: string, relocatedBundle = false): IndexedTask => {
    const record = createTaskRecord({ taskId: id, title: "Synthetic fixture" });
    const taskFile = file(path, renderTaskMarkdown(record, "Local task note content"));
    const indexedTask = { record, taskFile, folderPath: relocatedBundle ? taskFile.parent!.path : root,
      archived: false, legacyWorkspace: false, relocatedBundle } as IndexedTask;
    indexed.set(id, indexedTask); allowed.set(id, files);
    return indexedTask;
  };
  task(target.id, target.observedPath, fileRoot);
  const app = { vault: {
    adapter, getAbstractFileByPath: (name: string) => entries.get(name) ?? null,
    read: vi.fn(async (source: TFile) => bytes.get(source.path)!),
    readBinary: vi.fn(async (source: TFile) => encoder.encode(bytes.get(source.path)!).buffer),
    createFolder: vi.fn(async (name: string) => { added.push(name); return folder(name); }),
    create: vi.fn(async (name: string, body: string) => { if (entries.has(name)) throw Error("collision"); added.push(name); return file(name, body); }),
    process: vi.fn(async (entry: TFile, update: (current: string) => string) => {
      const result = update(bytes.get(entry.path)!); bytes.set(entry.path, result); return result;
    }),
  } };
  const service = {
    copyFolderForTask(id: string) { return { folderPath: allowed.get(id) }; },
    getById(id: string) { if (!indexed.has(id)) throw Error("unavailable"); return indexed.get(id); },
    list() { return [...indexed.values()]; },
  };
  const workspace = new VaultObjectiveReviewWorkspace(app as unknown as App, service as unknown as TaskWorkspaceService,
    () => ({ activeRoot: "Fixture/Active", archiveRoot: "Fixture/Archive" }) as TaskManagerSettings);
  return { app, workspace, bytes, added, file, folder, task };
}
const desktopDirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  Object.assign(Platform, { isDesktopApp: false });
  await Promise.all(desktopDirs.splice(0).map((directory) => rm(directory,{ recursive: true, force: true })));
});

describe("production Objective Review scope/storage adapter", () => {
  it("identifies generated events without shadowing similarly named user folders", () => {
    const root = "Fixture/Active";
    expect(isReviewStorePath(root + "/Objective File Reviews", root)).toBe(true);
    expect(isReviewStorePath(root + "/Objective File Reviews/a.json", root)).toBe(true);
    expect(isReviewStorePath(root + "/Objective File Reviews Other/a.json", root)).toBe(false);
    expect(isReviewStorePath("Fixture/Archive/Objective File Reviews/a.json", root)).toBe(false);
  });

  it("includes only exact nested Files, excluding generated state and similarly named and linked siblings", async () => {
    const f = fixture();
    const marker = "only the selected files";
    f.file(fileRoot + "/Deep/Note.txt", marker);
    f.file(fileRoot + "/Objective File Review.fjg.json", "not a source");
    f.file(fileRoot + "/copy.objective-file-review.fjg.json", "not a source");
    f.file(fileRoot + "/updates.md", "not user Files evidence");
    f.file(fileRoot + "-Else/Other.txt", "outside selected root");
    const plan = await f.workspace.snapshot(target);
    expect(plan.files.map((item) => item.relativePath)).toEqual(["Deep/Note.txt"]);
    expect(new TextDecoder().decode(await f.workspace.readSource(target, plan.files[0]))).toBe(marker);
  });

  it("refuses a shared legacy path, stale selected ID, or a nested objective bundle and all its files", async () => {
    const f = fixture();
    const flat = root + "/Tasks/Flat.md";
    f.task("tsk_shared", flat, root + "/Files");
    await expect(f.workspace.snapshot({ id: "tsk_shared", observedPath: flat })).rejects.toThrow(/exclusive|shared/i);
    await expect(f.workspace.snapshot({ ...target, observedPath: flat })).rejects.toThrow(/changed/i);
    f.task("tsk_nested", fileRoot + "/task.md", fileRoot + "/Files", true);
    f.file(fileRoot + "/Files/Unrelated.txt", "another objective");
    await expect(f.workspace.snapshot(target)).rejects.toThrow(/exclusive|shared/i);
    expect(f.app.vault.readBinary).not.toHaveBeenCalled();
  });

  it("does not replace an unrelated review file and saves only under the configured active root", async () => {
    const f = fixture();
    f.file(fileRoot + "/Unusable.xyz", "not read");
    const state = "Fixture/Active/Objective File Reviews/tsk_synthetic.objective-file-review.fjg.json";
    const service = new ObjectiveFileReviewService(f.workspace, () => { throw Error("should not need a key"); });
    await service.run(await service.prepare(target));
    expect(f.added).toEqual(["Fixture/Active/Objective File Reviews", state]);
    expect(f.bytes.get(fileRoot + "/Unusable.xyz")).toBe("not read");
    f.bytes.set(state, "existing unrelated bytes");
    await expect(service.prepare(target)).rejects.toThrow(/already used|invalid/i);
    expect(f.bytes.get(state)).toBe("existing unrelated bytes");
    expect(f.app.vault.process).not.toHaveBeenCalled();
  });

  it("uses a real descriptor on desktop and blocks linked file escapes", async () => {
    Object.assign(Platform, { isDesktopApp: true });
    vi.stubGlobal("require", createRequire(import.meta.url));
    const base = await mkdtemp(join(await realpath(tmpdir()), "objective-files-fixture-")); desktopDirs.push(base);
    const Desktop = FileSystemAdapter as unknown as new (base: string) => FileSystemAdapter;
    const f = fixture(new Desktop(base));
    const approvedPath = fileRoot + "/Approved.txt";
    f.file(approvedPath, "only approved");
    await mkdir(join(base, fileRoot), { recursive: true });
    await mkdir(join(base, target.observedPath, ".."), { recursive: true });
    await writeFile(join(base, target.observedPath), f.bytes.get(target.observedPath)!);
    await writeFile(join(base, approvedPath), "only approved");
    const source = (await f.workspace.snapshot(target)).files[0];
    expect(new TextDecoder().decode(await f.workspace.readSource(target, source))).toBe("only approved");
    const outsidePath = join(base, "Other.txt");
    await writeFile(outsidePath, "must not read");
    const linkedPath = fileRoot + "/Linked.txt";
    f.file(linkedPath, "must not read");
    await symlink(outsidePath, join(base, linkedPath));
    await expect(f.workspace.snapshot(target)).rejects.toThrow(/exclusive|linked/i);
    expect(await readFile(outsidePath,"utf8")).toBe("must not read");
    expect(f.app.vault.readBinary).not.toHaveBeenCalled();
  });
});
