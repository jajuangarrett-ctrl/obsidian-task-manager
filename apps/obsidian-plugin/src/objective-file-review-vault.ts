import { isObjectiveFileName } from "./objective-file-names";
import { App, FileSystemAdapter, Platform, TFile, TFolder } from "obsidian";
import { parseTaskMarkdown, taskArtifactFilesPath } from "@fjg/task-core";
import type { Stats } from "node:fs";
import type { TaskWorkspaceService, IndexedTask } from "./workspace-service";
import type { TaskManagerSettings } from "./settings";
import {
  isReviewArtifact, safeReviewPath, ObjectiveFileReviewError, REVIEW_MAX_SOURCES, REVIEW_MAX_PDF_BYTES,
  type ReviewScope, type ReviewTarget, type ReviewWorkspace, type ReviewWorkspaceFile,
} from "./objective-file-review";
import { REVIEW_MAX_FILE_BYTES } from "./objective-file-review-extract";

export const REVIEW_STORE_FOLDER = "Objective File Reviews";
export const REVIEW_STORE_SUFFIX = ".objective-file-review.fjg.json";
export function isReviewStorePath(path: string, activeRoot: string): boolean {
  if (!safeReviewPath(activeRoot)) return false;
  const root = activeRoot + "/" + REVIEW_STORE_FOLDER;
  return path === root || path.startsWith(root + "/");
}
const MAX_NODE_COUNT = 800;
const MAX_NOTE_BYTES = 1_500_000;
const MAX_STATE_BYTES = 500_000;
const stale = () => new ObjectiveFileReviewError("The objective or its Files changed. Reopen Review Files to try again.");
const invalidScope = () => new ObjectiveFileReviewError("An exclusive Files folder could not be verified for this objective. Shared or linked folders are not sent.");
const invalidStorage = () => new ObjectiveFileReviewError("The saved-review folder or file could not be verified. No existing file was changed.");
const encloses = (root: string, child: string) => child.startsWith(root + "/");
const errno = (error: unknown) => (error as { code?: string } | null)?.code;

type SafeScope = { task: IndexedTask; files: string; stateFolder: string; state: string };

function exclusiveFilesPath(task: IndexedTask): string {
  const canonical = /^(.+)\/Tasks\/([^/]+)\/task\.md$/i.exec(task.taskFile.path);
  return task.relocatedBundle ? task.folderPath + "/Files"
    : task.legacyWorkspace ? task.folderPath + "/attachments"
    : canonical ? taskArtifactFilesPath(canonical[1], canonical[2]) : "";
}
type DesktopRuntime = {
  fs: typeof import("node:fs/promises");
  constants: typeof import("node:fs").constants;
  path: typeof import("node:path");
  base: string;
};

function statKey(state: Stats): string {
  return [state.dev, state.ino, state.mode, state.size, state.mtimeMs, state.ctimeMs, state.nlink].join(":");
}

export class VaultObjectiveReviewWorkspace implements ReviewWorkspace {
  private sequence = 0;
  private readonly objects = new WeakMap<TFile | TFolder, number>();

  constructor(
    private readonly app: App,
    private readonly tasks: TaskWorkspaceService,
    private readonly getSettings: () => TaskManagerSettings,
  ) {}

  private objectId(entry: TFile | TFolder): number {
    const existing = this.objects.get(entry);
    if (existing) return existing;
    const id = ++this.sequence;
    this.objects.set(entry, id);
    return id;
  }

  private scope(target: ReviewTarget): SafeScope {
    if (!safeReviewPath(target.observedPath) || !/^[A-Za-z0-9_-]{1,140}$/.test(target.id)) throw stale();
    let task: IndexedTask, files: string;
    try {
      task = this.tasks.getById(target.id);
      files = this.tasks.copyFolderForTask(target.id).folderPath;
    } catch { throw stale(); }
    if (task.taskFile.path !== target.observedPath || this.app.vault.getAbstractFileByPath(target.observedPath) !== task.taskFile) throw stale();
    const expectedFiles = exclusiveFilesPath(task);
    if (!expectedFiles || files !== expectedFiles || !safeReviewPath(files) ||
        (task.relocatedBundle || task.legacyWorkspace) && task.taskFile.parent?.path !== task.folderPath) throw invalidScope();
    const active = this.getSettings().activeRoot;
    if (!safeReviewPath(active)) throw invalidStorage();
    const stateFolder = active + "/" + REVIEW_STORE_FOLDER;
    if (files === stateFolder || encloses(stateFolder, files) || encloses(files, stateFolder)) throw invalidScope();
    return { task, files, stateFolder, state: stateFolder + "/" + target.id + REVIEW_STORE_SUFFIX };
  }

  private desktop(): DesktopRuntime | null {
    if (!Platform.isDesktopApp) return null;
    try {
      if (typeof FileSystemAdapter !== "function" || !(this.app.vault.adapter instanceof FileSystemAdapter) ||
          typeof require !== "function") throw invalidScope();
      const api = require("node:fs") as typeof import("node:fs");
      const path = require("node:path") as typeof import("node:path");
      return { fs: api.promises, constants: api.constants, path, base: this.app.vault.adapter.getBasePath() };
    } catch { throw invalidScope(); }
  }

  /** Prove every component below the already-open vault, never trust a matched basename or symlink. */
  private async audit(runtime: DesktopRuntime, name: string, isDirectory: boolean, missing = false): Promise<{ full: string; stat: Stats } | null> {
    if (!safeReviewPath(name)) throw invalidScope();
    const base = await runtime.fs.realpath(runtime.base);
    const parts = name.split("/");
    let full = base;
    for (let i = 0; i < parts.length; i++) {
      full = runtime.path.join(full, parts[i]);
      let info: Stats;
      try { info = await runtime.fs.lstat(full); }
      catch (error) { if (missing && errno(error) === "ENOENT") return null; throw error; }
      const last = i === parts.length - 1;
      if (info.isSymbolicLink() || (last && !isDirectory ? !info.isFile() || info.nlink !== 1 : !info.isDirectory())) throw invalidScope();
      if (last) return { full, stat: info };
    }
    throw invalidScope();
  }

  private async verifyCanonical(target: ReviewTarget, desktop: DesktopRuntime | null): Promise<SafeScope> {
    const selected = this.scope(target);
    const file = selected.task.taskFile;
    // Read only the exact canonical identity locally; no note data is sent.
    try {
      const physical = desktop ? await this.audit(desktop, target.observedPath, false) : null;
      if ((physical?.stat.size ?? file.stat.size) > MAX_NOTE_BYTES ||
          parseTaskMarkdown(await this.app.vault.read(file)).record.task_id !== target.id) throw stale();
      if (desktop) {
        const latest = await this.audit(desktop, target.observedPath, false);
        if (!physical || !latest || statKey(physical.stat) !== statKey(latest.stat)) throw stale();
      }
    } catch { throw stale(); }
    const current = this.scope(target);
    if (current.files !== selected.files || current.state !== selected.state || current.task.taskFile !== file) throw stale();
    return current;
  }

  async snapshot(target: ReviewTarget): Promise<ReviewScope> {
    const desktop = this.desktop();
    const { task, files, stateFolder } = await this.verifyCanonical(target, desktop);
    const folder = this.app.vault.getAbstractFileByPath(files);
    const physicalFolder = desktop ? await this.audit(desktop, files, true, true) : null;
    if ((folder && !(folder instanceof TFolder)) || (desktop && Boolean(folder) !== Boolean(physicalFolder))) throw invalidScope();
    for (const other of this.tasks.list({ includeArchived: true })) {
      if (other.taskFile === task.taskFile) continue;
      const foreignFiles = exclusiveFilesPath(other);
      if (encloses(files, other.taskFile.path) || (foreignFiles &&
        (foreignFiles === files || encloses(files, foreignFiles) || encloses(foreignFiles, files)))) {
        throw invalidScope();
      }
    }
    const result: ReviewWorkspaceFile[] = [];
    let scanned = 0;
    const visit = async (current: TFolder, depth: number) => {
      if (depth > 32) throw new ObjectiveFileReviewError("The Files folder is too deeply nested for a safe review. No file was sent.");
      if (current.children.some((entry) => entry instanceof TFile && isObjectiveFileName(entry.name, "Task"))) {
        // A nested bundle can be unindexed, conflicting or awaiting Sync. It
        // does not authorize any surrounding attachment for this objective.
        throw invalidScope();
      }
      for (const entry of current.children) {
        if (++scanned > MAX_NODE_COUNT) {
          throw new ObjectiveFileReviewError("This Files folder has too many items for a safe review. No file was sent.");
        }
        if (entry.name.startsWith(".") || isReviewArtifact(entry.name)) continue;
        if (entry.parent !== current || entry.path !== current.path + "/" + entry.name || !encloses(files, entry.path)) throw stale();
        if (entry instanceof TFolder) {
          if (desktop) await this.audit(desktop, entry.path, true);
          await visit(entry, depth + 1);
        } else if (entry instanceof TFile) {
          // Ignore plugin task/update control notes, not ordinary nested files.
          if (/^(task|updates)\.md$/i.test(entry.name)) continue;
          const physical = desktop ? await this.audit(desktop, entry.path, false) : null;
          const relativePath = entry.path.slice(files.length + 1);
          if (!safeReviewPath(relativePath)) throw invalidScope();
          if (result.length >= REVIEW_MAX_SOURCES) throw new ObjectiveFileReviewError("This Files folder has too many items for a safe review. No file was sent.");
          result.push({ relativePath, extension: entry.extension, size: physical?.stat.size ?? entry.stat.size,
            revision: this.objectId(entry) + ":" + (physical
              ? statKey(physical.stat) : [entry.stat.size, entry.stat.ctime, entry.stat.mtime].join(":")) });
        }
      }
    };
    if (folder instanceof TFolder) await visit(folder, 0);
    if (task.taskFile.path !== target.observedPath || this.scope(target).files !== files) throw stale();
    result.sort((a,b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
    const scopeKey = JSON.stringify([target.observedPath, files, stateFolder, this.objectId(task.taskFile),
      folder instanceof TFolder ? this.objectId(folder) : null, physicalFolder?.stat.ino ?? null]);
    return { title: task.record.title, scopeKey, files: result };
  }

  async readSource(target: ReviewTarget, file: ReviewWorkspaceFile): Promise<ArrayBuffer> {
    const { files } = this.scope(target);
    if (!safeReviewPath(file.relativePath) || isReviewArtifact(file.relativePath.split("/").at(-1) ?? "")) throw invalidScope();
    const name = files + "/" + file.relativePath;
    const entry = this.app.vault.getAbstractFileByPath(name);
    if (!(entry instanceof TFile) || entry.path !== name) throw stale();
    const max = file.extension.toLowerCase() === "pdf" ? REVIEW_MAX_PDF_BYTES : REVIEW_MAX_FILE_BYTES;
    if (file.size > max) throw stale();
    const desktop = this.desktop();
    if (!desktop) {
      const revision = () => this.objectId(entry) + ":" + [entry.stat.size, entry.stat.ctime, entry.stat.mtime].join(":");
      if (revision() !== file.revision) throw stale();
      const bytes = await this.app.vault.readBinary(entry);
      if (bytes.byteLength !== file.size || this.scope(target).files !== files || entry.path !== name || revision() !== file.revision) throw stale();
      return bytes;
    }
    const approved = await this.audit(desktop, name, false);
    if (!approved || this.objectId(entry) + ":" + statKey(approved.stat) !== file.revision || approved.stat.size !== file.size) throw stale();
    const handle = await desktop.fs.open(approved.full, desktop.constants.O_RDONLY | desktop.constants.O_NOFOLLOW | desktop.constants.O_NONBLOCK);
    try {
      const key = statKey(approved.stat);
      if (statKey(await handle.stat()) !== key) throw stale();
      const buffer = new ArrayBuffer(file.size);
      const bytes = new Uint8Array(buffer);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw stale();
        offset += bytesRead;
      }
      const latest = await this.audit(desktop, name, false);
      if (!latest || statKey(latest.stat) !== key || statKey(await handle.stat()) !== key ||
          this.scope(target).files !== files || entry.path !== name) throw stale();
      return buffer;
    } finally { await handle.close(); }
  }

  async load(target: ReviewTarget): Promise<string | null> {
    const desktop = this.desktop();
    const { state } = await this.verifyCanonical(target, desktop);
    try {
      const physical = desktop ? await this.audit(desktop, state, false, true) : null;
      const entry = this.app.vault.getAbstractFileByPath(state);
      if (desktop && Boolean(entry) !== Boolean(physical)) throw invalidStorage();
      if (!entry) return null;
      if (!(entry instanceof TFile) || entry.path !== state || (physical?.stat.size ?? entry.stat.size) > MAX_STATE_BYTES) throw invalidStorage();
      const result = await this.app.vault.read(entry);
      if (entry.path !== state || this.scope(target).state !== state) throw stale();
      if (desktop) {
        const latest = await this.audit(desktop, state, false);
        if (!latest || !physical || statKey(latest.stat) !== statKey(physical.stat)) throw invalidStorage();
      }
      return result;
    } catch (error) { if (error instanceof ObjectiveFileReviewError) throw error; throw invalidStorage(); }
  }

  async save(target: ReviewTarget, expected: string | null, next: string): Promise<void> {
    const { stateFolder, state } = this.scope(target);
    if (await this.load(target) !== expected) throw stale();
    try {
      const desktop = this.desktop();
      let folder = this.app.vault.getAbstractFileByPath(stateFolder);
      if (!folder) {
        if (desktop && await this.audit(desktop, stateFolder, true, true)) throw invalidStorage();
        // Only this one generated directory beneath the configured active root.
        try { await this.app.vault.createFolder(stateFolder); }
        catch { if (!(this.app.vault.getAbstractFileByPath(stateFolder) instanceof TFolder)) throw invalidStorage(); }
        folder = this.app.vault.getAbstractFileByPath(stateFolder);
      }
      if (!(folder instanceof TFolder) || folder.path !== stateFolder || this.scope(target).state !== state) throw invalidStorage();
      if (desktop) await this.audit(desktop, stateFolder, true);
      const entry = this.app.vault.getAbstractFileByPath(state);
      if (expected === null) {
        if (entry || (desktop && await this.audit(desktop, state, false, true))) throw stale();
        if (this.scope(target).state !== state) throw stale();
        await this.app.vault.create(state, next);
      } else {
        if (!(entry instanceof TFile) || entry.path !== state) throw stale();
        if (desktop) await this.audit(desktop, state, false);
        await this.app.vault.process(entry, (current) => {
          if (current !== expected || entry.path !== state || this.scope(target).state !== state) throw stale();
          return next;
        });
      }
    } catch (error) { if (error instanceof ObjectiveFileReviewError) throw error; throw invalidStorage(); }
  }
}
