import { App, normalizePath, TAbstractFile, TFile, TFolder } from "obsidian";
import {
  appendUpdateMarkdown,
  createTaskRecord,
  NewTaskInput,
  normalizeStatus,
  parseTaskMarkdown,
  renderTaskMarkdown,
  renderUpdatesMarkdown,
  sanitizeTitleForPath,
  TaskRecord,
  TaskStatus,
  TaskUpdateInput,
  taskFilePath,
  taskFolderPath,
  transitionTaskRecord,
  updateTaskFields,
  updatesFilePath,
  validateTaskRecord
} from "@fjg/task-core";
import type { CatalogTask, CreateTaskItem } from "@fjg/task-protocol";
import type { TaskManagerSettings } from "./settings";
import { parseTaskUpdatePreviews, TaskUpdatePreview } from "./update-preview";
import {
  archiveProjectRecord,
  createProjectRecord,
  parseProjectDocument,
  parseProjectMarkdown,
  ProjectRecord,
  renderProjectDocument,
  reopenProjectRecord,
  renderProjectMarkdown
} from "./project-workspace";
import {
  isCanonicalTaskFile,
  markdownPreview,
  RelatedFileKind,
  relatedFileKind,
  safeRelatedFileName
} from "./related-files";

export interface TaskRelatedFile {
  file: TFile;
  kind: RelatedFileKind;
  preview: string;
}

export interface IndexedTask {
  record: TaskRecord;
  statusAssigned: boolean;
  folderPath: string;
  taskFile: TFile;
  updatesFile: TFile | null;
  updates: TaskUpdatePreview[];
  relatedFiles: TaskRelatedFile[];
  archived: boolean;
}

export interface IndexedProject {
  record: ProjectRecord;
  folderPath: string;
  projectFile: TFile;
  archived: boolean;
}

export class TaskWorkspaceService {
  private readonly index = new Map<string, IndexedTask>();
  private readonly projectIndex = new Map<string, IndexedProject>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => TaskManagerSettings
  ) {}

  async initialize(): Promise<void> {
    const settings = this.getSettings();
    await this.ensureFolder(settings.activeRoot);
    await this.ensureFolder(settings.archiveRoot);
    await this.ensureFolder(settings.projectRoot);
    await this.ensureFolder(settings.projectArchiveRoot);
    await this.refresh();
    await this.normalizeProjectPropertySuggestions();
    await this.normalizeVisibleFolderNames();
  }

  async refresh(): Promise<void> {
    const settings = this.getSettings();
    const activePrefix = `${normalizePath(settings.activeRoot)}/`;
    const archivePrefix = `${normalizePath(settings.archiveRoot)}/`;
    const projectPrefix = `${normalizePath(settings.projectRoot)}/`;
    const projectArchivePrefix = `${normalizePath(settings.projectArchiveRoot)}/`;
    const next = new Map<string, IndexedTask>();
    const nextProjects = new Map<string, IndexedProject>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.name === "task.md" && (file.path.startsWith(activePrefix) || file.path.startsWith(archivePrefix))) {
        try {
          const document = parseTaskMarkdown(await this.app.vault.cachedRead(file));
          if (next.has(document.record.task_id)) throw new Error(`Duplicate task ID ${document.record.task_id}`);
          const folderPath = file.parent?.path || "";
          const updateFile = this.app.vault.getAbstractFileByPath(updatesFilePath(folderPath));
          const updates = updateFile instanceof TFile
            ? parseTaskUpdatePreviews(await this.app.vault.cachedRead(updateFile))
            : [];
          next.set(document.record.task_id, {
            record: document.record,
            statusAssigned: document.statusRecognized,
            folderPath,
            taskFile: file,
            updatesFile: updateFile instanceof TFile ? updateFile : null,
            updates,
            relatedFiles: [],
            archived: file.path.startsWith(archivePrefix)
          });
        } catch (error) {
          console.error("[FJG Task Manager] Invalid task workspace", file.path, error);
        }
      } else if (
        file.name === "project.md"
        && (file.path.startsWith(projectPrefix) || file.path.startsWith(projectArchivePrefix))
      ) {
        try {
          const record = parseProjectMarkdown(await this.app.vault.cachedRead(file));
          const archived = file.path.startsWith(projectArchivePrefix);
          const key = projectIndexKey(record.name, archived);
          if (nextProjects.has(key)) throw new Error(`Duplicate project name ${record.name}`);
          nextProjects.set(key, {
            record: {
              ...record,
              status: archived ? "archived" : "active",
              archived_at: archived ? record.archived_at : ""
            },
            folderPath: file.parent?.path || "",
            projectFile: file,
            archived
          });
        } catch (error) {
          console.error("[FJG Task Manager] Invalid project workspace", file.path, error);
        }
      }
    }
    const vaultFiles = this.app.vault.getFiles();
    for (const task of next.values()) {
      const related = vaultFiles
        .filter((file) => file.path.startsWith(`${task.folderPath}/`) && !isCanonicalTaskFile(file.name))
        .sort((left, right) => right.stat.mtime - left.stat.mtime || left.name.localeCompare(right.name));
      for (const file of related) {
        const kind = relatedFileKind(file.extension);
        let preview = "";
        if (kind === "note" && file.stat.size <= 256 * 1024) {
          try {
            preview = markdownPreview(await this.app.vault.cachedRead(file));
          } catch (error) {
            console.warn("[FJG Task Manager] Could not preview related note", file.path, error);
          }
        }
        task.relatedFiles.push({ file, kind, preview });
      }
    }
    this.index.clear();
    for (const [id, task] of next) this.index.set(id, task);
    this.projectIndex.clear();
    for (const [key, project] of nextProjects) this.projectIndex.set(key, project);
  }

  list(options: { includeArchived?: boolean } = {}): IndexedTask[] {
    return [...this.index.values()]
      .filter((task) => options.includeArchived || !task.archived)
      .sort((left, right) => {
        const dueCompare = (left.record.due || "9999-12-31").localeCompare(right.record.due || "9999-12-31");
        return dueCompare || left.record.title.localeCompare(right.record.title);
      });
  }

  listProjects(options: { includeArchived?: boolean } = {}): IndexedProject[] {
    return [...this.projectIndex.values()]
      .filter((project) => options.includeArchived || !project.archived)
      .sort((left, right) => left.record.name.localeCompare(right.record.name));
  }

  projectNames(): string[] {
    const projects = new Map<string, string>();
    for (const project of this.listProjects()) {
      projects.set(normalizeSearch(project.record.name), project.record.name);
    }
    for (const task of this.list()) {
      const name = task.record.project.trim();
      const key = normalizeSearch(name);
      if (name && !projects.has(key)) projects.set(key, name);
    }
    return [...projects.values()].sort((left, right) => left.localeCompare(right));
  }

  async createProject(name: string, description = ""): Promise<IndexedProject> {
    const record = createProjectRecord(name);
    const key = normalizeSearch(record.name);
    const registered = this.listProjects({ includeArchived: true })
      .find((project) => normalizeSearch(project.record.name) === key);
    if (registered?.archived) {
      throw new Error(`Archived project already exists: ${record.name}. Reopen it instead.`);
    }
    if (registered || this.projectNames().some((project) => normalizeSearch(project) === key)) {
      throw new Error(`Project already exists: ${record.name}`);
    }
    const folderPath = await this.availableProjectPath(this.getSettings().projectRoot, record.name);
    await this.ensureFolder(folderPath);
    const projectPath = `${folderPath}/project.md`;
    let projectFile: TFile | null = null;
    try {
      projectFile = await this.app.vault.create(projectPath, renderProjectMarkdown(record, description));
    } catch (error) {
      if (projectFile) await this.app.vault.delete(projectFile, true);
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (folder instanceof TFolder) await this.app.vault.delete(folder, true);
      throw error;
    }
    await this.refresh();
    const project = this.projectIndex.get(projectIndexKey(record.name, false));
    if (!project) throw new Error(`Project was created but could not be indexed: ${record.name}`);
    return project;
  }

  getProjectByName(name: string, options: { archived?: boolean } = {}): IndexedProject {
    const archived = options.archived === true;
    const project = this.projectIndex.get(projectIndexKey(name, archived));
    if (!project) {
      throw new Error(`${archived ? "Archived project" : "Project"} not found: ${name}`);
    }
    return project;
  }

  async archiveProject(name: string): Promise<{ project: IndexedProject; archivedTaskCount: number }> {
    let project = this.getProjectByName(name);
    const projectKey = normalizeSearch(project.record.name);
    const assignedTasks = this.list().filter((task) => normalizeSearch(task.record.project) === projectKey);
    const openTasks = assignedTasks.filter((task) => task.record.status !== "completed");
    if (openTasks.length) {
      throw new Error(
        `${project.record.name} still has ${openTasks.length} open ${openTasks.length === 1 ? "task" : "tasks"}. `
        + "Complete or archive them before archiving the project."
      );
    }

    const completedTasks = assignedTasks.filter((task) => task.record.status === "completed");
    for (const task of completedTasks) {
      await this.changeStatus(
        task.record.task_id,
        "archived",
        "Franklin",
        `Archived with completed project ${project.record.name}.`
      );
    }

    project = this.getProjectByName(name);
    const oldContent = await this.app.vault.read(project.projectFile);
    const document = parseProjectDocument(oldContent);
    const nextRecord = archiveProjectRecord(document.record);
    try {
      await this.app.vault.modify(project.projectFile, renderProjectDocument(nextRecord, document.body));
      await this.moveProjectWorkspace(project.folderPath, this.getSettings().projectArchiveRoot, nextRecord.name);
    } catch (error) {
      const currentFile = this.app.vault.getAbstractFileByPath(project.projectFile.path);
      if (currentFile instanceof TFile) await this.app.vault.modify(currentFile, oldContent);
      throw error;
    }
    await this.refresh();
    return {
      project: this.getProjectByName(name, { archived: true }),
      archivedTaskCount: completedTasks.length
    };
  }

  async reopenProject(name: string): Promise<IndexedProject> {
    const project = this.getProjectByName(name, { archived: true });
    const active = this.projectIndex.get(projectIndexKey(project.record.name, false));
    if (active) throw new Error(`An active project already exists: ${project.record.name}`);

    const oldContent = await this.app.vault.read(project.projectFile);
    const document = parseProjectDocument(oldContent);
    const nextRecord = reopenProjectRecord(document.record);
    try {
      await this.app.vault.modify(project.projectFile, renderProjectDocument(nextRecord, document.body));
      await this.moveProjectWorkspace(project.folderPath, this.getSettings().projectRoot, nextRecord.name);
    } catch (error) {
      const currentFile = this.app.vault.getAbstractFileByPath(project.projectFile.path);
      if (currentFile instanceof TFile) await this.app.vault.modify(currentFile, oldContent);
      throw error;
    }
    await this.refresh();
    return this.getProjectByName(name);
  }

  catalog(): CatalogTask[] {
    return this.list({ includeArchived: true }).map((task) => ({
      task_id: task.record.task_id,
      title: task.record.title,
      status: task.record.status,
      project: task.record.project,
      delegated_to: task.record.delegated_to,
      path: task.folderPath,
      archived: task.archived
    }));
  }

  search(query: string, limit = 20): CatalogTask[] {
    const clean = normalizeSearch(query);
    const tokens = clean.split(" ").filter(Boolean);
    return this.catalog()
      .map((task) => {
        const haystack = normalizeSearch([
          task.task_id,
          task.title,
          task.status,
          task.project,
          task.delegated_to,
          task.path
        ].join(" "));
        const matches = tokens.every((token) => haystack.includes(token));
        const exact = normalizeSearch(task.task_id) === clean || normalizeSearch(task.title) === clean;
        return { task, matches, exact };
      })
      .filter((entry) => entry.matches)
      .sort((left, right) => Number(right.exact) - Number(left.exact) || left.task.title.localeCompare(right.task.title))
      .slice(0, Math.max(1, Math.min(limit, 50)))
      .map((entry) => entry.task);
  }

  getById(taskId: string): IndexedTask {
    const task = this.index.get(taskId);
    if (!task) throw new Error(`No task matched ID ${taskId}.`);
    return task;
  }

  findByIdOrQuery(taskId: string, query = ""): IndexedTask {
    if (taskId && this.index.has(taskId)) return this.getById(taskId);
    const clean = normalizeSearch(query);
    if (!clean) throw new Error("A task ID is required.");
    const matches = this.list({ includeArchived: true }).filter((task) => {
      return [
        task.record.title,
        task.folderPath,
        task.taskFile.path,
        task.record.task_id
      ].some((value) => normalizeSearch(value) === clean);
    });
    if (matches.length === 1) return matches[0];
    if (!matches.length) throw new Error(`No task matched "${query}".`);
    throw new Error(`Multiple tasks matched "${query}". Select a stable task ID.`);
  }

  resolveFromFile(file: TFile | null): IndexedTask | null {
    if (!file) return null;
    return this.list({ includeArchived: true }).find((task) => {
      return file.path === task.taskFile.path || file.path.startsWith(`${task.folderPath}/`);
    }) || null;
  }

  async createFromClip(item: CreateTaskItem, requestId: string, createdAt: string): Promise<IndexedTask> {
    return this.createTask({
      title: item.title,
      details: item.details,
      status: item.status,
      project: item.project,
      source: item.source,
      tags: item.tags,
      createdAt
    }, { requestId, actor: "Browser clipper" });
  }

  async createTask(
    input: NewTaskInput,
    audit: { requestId?: string; actor?: string } = {}
  ): Promise<IndexedTask> {
    const record = createTaskRecord(input);
    if (this.index.has(record.task_id)) throw new Error(`Task ID ${record.task_id} already exists.`);
    const root = record.status === "archived" ? this.getSettings().archiveRoot : this.getSettings().activeRoot;
    const folderPath = await this.availableWorkspacePath(root, record);
    await this.ensureFolder(folderPath);
    const taskPath = taskFilePath(folderPath);
    const updatesPath = updatesFilePath(folderPath);
    const body = buildTaskBody(record, input.details || "", input.outcome || "");
    let taskFile: TFile | null = null;
    try {
      taskFile = await this.app.vault.create(taskPath, renderTaskMarkdown(record, body));
      const updates = appendUpdateMarkdown(renderUpdatesMarkdown(), {
        actor: audit.actor || "Franklin",
        type: input.legacyStatus ? "migration" : "created",
        text: input.legacyStatus ? `Imported task from legacy status ${input.legacyStatus}.` : "Task workspace created.",
        createdAt: record.created_at,
        requestId: audit.requestId,
        newStatus: record.status
      });
      await this.app.vault.create(updatesPath, updates);
      await this.ensureFolder(`${folderPath}/attachments`);
    } catch (error) {
      if (taskFile) await this.app.vault.delete(taskFile, true);
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (folder instanceof TFolder) await this.app.vault.delete(folder, true);
      throw error;
    }
    await this.refresh();
    return this.getById(record.task_id);
  }

  async createTasks(
    inputs: NewTaskInput[],
    audit: { requestId?: string; actor?: string } = {}
  ): Promise<IndexedTask[]> {
    if (!inputs.length) throw new Error("Add at least one task.");
    const planned = inputs.map((input) => {
      const record = createTaskRecord(input);
      return {
        ...input,
        taskId: record.task_id,
        createdAt: record.created_at,
        updatedAt: record.updated_at
      };
    });
    const plannedIds = new Set<string>();
    for (const input of planned) {
      if (!input.taskId || this.index.has(input.taskId) || plannedIds.has(input.taskId)) {
        throw new Error(`Task ID ${input.taskId || "unknown"} already exists.`);
      }
      plannedIds.add(input.taskId);
    }

    const created: IndexedTask[] = [];
    try {
      for (const input of planned) {
        created.push(await this.createTask(input, audit));
      }
      return created;
    } catch (error) {
      try {
        await this.rollbackTaskWorkspaces(plannedIds);
      } catch (rollbackError) {
        await this.refresh();
        throw new Error(
          `Batch creation failed and rollback needs attention: `
          + `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
        );
      }
      await this.refresh();
      throw new Error(`Batch creation was rolled back: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async appendUpdate(taskId: string, input: TaskUpdateInput): Promise<IndexedTask> {
    const task = this.getById(taskId);
    const updatesFile = await this.ensureUpdatesFile(task);
    const current = await this.app.vault.read(updatesFile);
    const next = appendUpdateMarkdown(current, input);
    if (next !== current) {
      await this.app.vault.modify(updatesFile, next);
      await this.touchTask(task, input.createdAt ? new Date(input.createdAt) : new Date());
    }
    await this.refresh();
    return this.getById(taskId);
  }

  async createRelatedNote(taskId: string, title: string, content = ""): Promise<TFile> {
    const task = this.getById(taskId);
    const cleanTitle = safeRelatedFileName(title, "Untitled note").replace(/\.md$/i, "").trim();
    if (!cleanTitle) throw new Error("Enter a note title.");
    if (isCanonicalTaskFile(`${cleanTitle}.md`)) {
      throw new Error("That name is reserved for the task workspace.");
    }
    const path = await this.availableFilePath(task.folderPath, `${cleanTitle}.md`);
    const body = [`# ${cleanTitle}`, "", content.trim(), ""].join("\n").replace(/\n{3,}/g, "\n\n");
    const file = await this.app.vault.create(path, body);
    await this.refresh();
    return file;
  }

  async importRelatedFiles(taskId: string, files: File[]): Promise<TFile[]> {
    const task = this.getById(taskId);
    const attachmentsPath = `${task.folderPath}/attachments`;
    await this.ensureFolder(attachmentsPath);
    const created: TFile[] = [];
    for (const source of files) {
      const name = safeRelatedFileName(source.name, "Attachment");
      const path = await this.availableFilePath(attachmentsPath, name);
      created.push(await this.app.vault.createBinary(path, await source.arrayBuffer()));
    }
    await this.refresh();
    return created;
  }

  async availableAttachmentPath(taskId: string, fileName: string, preferredPath = ""): Promise<string> {
    const task = this.getById(taskId);
    const attachmentsPath = normalizePath(`${task.folderPath}/attachments`);
    await this.ensureFolder(attachmentsPath);
    if (preferredPath) {
      const normalized = normalizePath(preferredPath);
      if (!normalized.startsWith(`${attachmentsPath}/`)) {
        throw new Error("The Gmail attachment destination is outside the task attachments folder.");
      }
      const cached = this.app.vault.getAbstractFileByPath(normalized);
      const diskEntry = cached ? null : await this.app.vault.adapter.stat(normalized);
      if (cached || diskEntry) {
        throw new Error(`The Gmail attachment destination already exists: ${normalized}`);
      }
      return normalized;
    }
    const name = safeRelatedFileName(fileName, "Email.md");
    return this.availableFilePath(attachmentsPath, name);
  }

  async moveVaultFileToTaskAttachments(taskId: string, source: TFile, targetPath: string): Promise<TFile> {
    const task = this.getById(taskId);
    const attachmentsPath = normalizePath(`${task.folderPath}/attachments`);
    const normalizedTarget = normalizePath(targetPath);
    if (!normalizedTarget.startsWith(`${attachmentsPath}/`)) {
      throw new Error("The Gmail attachment destination is outside the task attachments folder.");
    }
    if (this.app.vault.getAbstractFileByPath(normalizedTarget) || await this.app.vault.adapter.stat(normalizedTarget)) {
      throw new Error(`The Gmail attachment destination already exists: ${normalizedTarget}`);
    }
    await this.app.fileManager.renameFile(source, normalizedTarget);
    await this.refresh();
    const moved = this.app.vault.getAbstractFileByPath(normalizedTarget);
    if (!(moved instanceof TFile)) {
      throw new Error(`The moved Gmail email was not found at ${normalizedTarget}.`);
    }
    return moved;
  }

  async changeStatus(
    taskId: string,
    target: string,
    actor = "Franklin",
    text = ""
  ): Promise<IndexedTask> {
    const task = this.getById(taskId);
    const status = normalizeStatus(target);
    const at = new Date();
    const oldTaskContent = await this.app.vault.read(task.taskFile);
    const taskDocument = parseTaskMarkdown(oldTaskContent);
    const nextRecord = transitionTaskRecord(taskDocument.record, status, at);
    const updatesFile = await this.ensureUpdatesFile(task);
    const oldUpdates = await this.app.vault.read(updatesFile);
    const type = status === "completed" ? "completed" : status === "archived" ? "archived" : task.record.status === "archived" ? "reopened" : "status-change";
    const nextUpdates = appendUpdateMarkdown(oldUpdates, {
      actor,
      type,
      text: text || `Status changed from ${task.record.status} to ${status}.`,
      previousStatus: task.record.status,
      newStatus: status,
      createdAt: at.toISOString()
    });
    try {
      await this.app.vault.modify(updatesFile, nextUpdates);
      await this.app.vault.modify(task.taskFile, renderTaskMarkdown(nextRecord, taskDocument.body));
      if (status === "archived" && !task.archived) {
        await this.moveWorkspace(task.folderPath, this.getSettings().archiveRoot, nextRecord);
      } else if (task.archived && status !== "archived") {
        await this.moveWorkspace(task.folderPath, this.getSettings().activeRoot, nextRecord);
      }
    } catch (error) {
      const currentTask = this.app.vault.getAbstractFileByPath(task.taskFile.path);
      if (currentTask instanceof TFile) await this.app.vault.modify(currentTask, oldTaskContent);
      const currentUpdates = this.app.vault.getAbstractFileByPath(updatesFile.path);
      if (currentUpdates instanceof TFile) await this.app.vault.modify(currentUpdates, oldUpdates);
      throw error;
    }
    await this.refresh();
    return this.getById(taskId);
  }

  async changeProject(
    taskId: string,
    projectName: string,
    actor = "Franklin"
  ): Promise<IndexedTask> {
    const task = this.getById(taskId);
    const nextProject = String(projectName || "").trim();
    if (task.record.project.trim() === nextProject) return task;

    const at = new Date();
    const oldTaskContent = await this.app.vault.read(task.taskFile);
    const taskDocument = parseTaskMarkdown(oldTaskContent);
    const nextRecord = updateTaskFields(taskDocument.record, { project: nextProject }, at);
    const updatesFile = await this.ensureUpdatesFile(task);
    const oldUpdates = await this.app.vault.read(updatesFile);
    const previous = task.record.project.trim() || "No project";
    const next = nextProject || "No project";
    const nextUpdates = appendUpdateMarkdown(oldUpdates, {
      actor,
      type: "fields-changed",
      text: `Project changed from ${previous} to ${next}.`,
      createdAt: at.toISOString()
    });

    try {
      await this.app.vault.modify(updatesFile, nextUpdates);
      await this.app.vault.modify(task.taskFile, renderTaskMarkdown(nextRecord, taskDocument.body));
    } catch (error) {
      const currentTask = this.app.vault.getAbstractFileByPath(task.taskFile.path);
      if (currentTask instanceof TFile) await this.app.vault.modify(currentTask, oldTaskContent);
      const currentUpdates = this.app.vault.getAbstractFileByPath(updatesFile.path);
      if (currentUpdates instanceof TFile) await this.app.vault.modify(currentUpdates, oldUpdates);
      throw error;
    }

    await this.refresh();
    return this.getById(taskId);
  }

  async validateAll(): Promise<Array<{ path: string; issues: string[] }>> {
    const results: Array<{ path: string; issues: string[] }> = [];
    for (const task of this.list({ includeArchived: true })) {
      try {
        const document = parseTaskMarkdown(await this.app.vault.cachedRead(task.taskFile));
        const issues = validateTaskRecord(document.record).map((issue) => `${issue.field}: ${issue.message}`);
        if (!task.updatesFile) issues.push("updates.md is missing.");
        if (issues.length) results.push({ path: task.folderPath, issues });
      } catch (error) {
        results.push({ path: task.folderPath, issues: [error instanceof Error ? error.message : String(error)] });
      }
    }
    return results;
  }

  private async touchTask(task: IndexedTask, at: Date): Promise<void> {
    const current = await this.app.vault.read(task.taskFile);
    const document = parseTaskMarkdown(current);
    const next = { ...document.record, updated_at: at.toISOString() };
    await this.app.vault.modify(task.taskFile, renderTaskMarkdown(next, document.body));
  }

  private async ensureUpdatesFile(task: IndexedTask): Promise<TFile> {
    if (task.updatesFile) return task.updatesFile;
    return this.app.vault.create(updatesFilePath(task.folderPath), renderUpdatesMarkdown());
  }

  private async moveWorkspace(currentPath: string, targetRoot: string, record: TaskRecord): Promise<void> {
    await this.ensureFolder(targetRoot);
    const folder = this.app.vault.getAbstractFileByPath(currentPath);
    if (!(folder instanceof TFolder)) throw new Error(`Workspace folder not found: ${currentPath}`);
    const destination = await this.availableWorkspacePath(targetRoot, record);
    await this.app.vault.rename(folder, destination);
  }

  private async moveProjectWorkspace(currentPath: string, targetRoot: string, name: string): Promise<void> {
    await this.ensureFolder(targetRoot);
    const folder = this.app.vault.getAbstractFileByPath(currentPath);
    if (!(folder instanceof TFolder)) throw new Error(`Project folder not found: ${currentPath}`);
    const destination = await this.availableProjectPath(targetRoot, name);
    await this.app.vault.rename(folder, destination);
  }

  async normalizeVisibleFolderNames(): Promise<void> {
    let changed = false;
    for (const task of this.list({ includeArchived: true })) {
      const root = task.archived ? this.getSettings().archiveRoot : this.getSettings().activeRoot;
      const destination = await this.availableWorkspacePath(root, task.record, task.folderPath);
      if (destination === task.folderPath) continue;
      const folder = this.app.vault.getAbstractFileByPath(task.folderPath);
      if (!(folder instanceof TFolder)) continue;
      await this.app.vault.rename(folder, destination);
      changed = true;
    }
    if (changed) await this.refresh();
  }

  private async normalizeProjectPropertySuggestions(): Promise<void> {
    let changed = false;
    for (const project of this.listProjects({ includeArchived: true })) {
      const current = await this.app.vault.read(project.projectFile);
      const document = parseProjectDocument(current);
      const next = renderProjectDocument(document.record, document.body);
      if (next === current) continue;
      await this.app.vault.modify(project.projectFile, next);
      changed = true;
    }
    if (changed) await this.refresh();
  }

  private async availableWorkspacePath(
    root: string,
    record: TaskRecord,
    currentPath = ""
  ): Promise<string> {
    for (let copyNumber = 1; copyNumber <= 999; copyNumber += 1) {
      const candidate = taskFolderPath(root, record.task_id, record.title, copyNumber);
      if (candidate === currentPath) return candidate;
      const cached = this.app.vault.getAbstractFileByPath(candidate);
      const diskEntry = cached ? null : await this.app.vault.adapter.stat(candidate);
      if (!cached && !diskEntry) return candidate;
    }
    throw new Error(`Could not create a unique workspace folder for ${record.title}.`);
  }

  private async availableFilePath(folderPath: string, fileName: string): Promise<string> {
    const dot = fileName.lastIndexOf(".");
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
    const extension = dot > 0 ? fileName.slice(dot) : "";
    for (let copyNumber = 1; copyNumber <= 999; copyNumber += 1) {
      const suffix = copyNumber === 1 ? "" : ` (${copyNumber})`;
      const candidate = normalizePath(`${folderPath}/${stem}${suffix}${extension}`);
      const cached = this.app.vault.getAbstractFileByPath(candidate);
      const diskEntry = cached ? null : await this.app.vault.adapter.stat(candidate);
      if (!cached && !diskEntry) return candidate;
    }
    throw new Error(`Could not create a unique file named ${fileName}.`);
  }

  private async availableProjectPath(root: string, name: string): Promise<string> {
    const base = sanitizeTitleForPath(name);
    for (let copyNumber = 1; copyNumber <= 999; copyNumber += 1) {
      const suffix = copyNumber === 1 ? "" : ` (${copyNumber})`;
      const candidate = normalizePath(`${root}/${base.slice(0, Math.max(1, 120 - suffix.length)).trim()}${suffix}`);
      const cached = this.app.vault.getAbstractFileByPath(candidate);
      const diskEntry = cached ? null : await this.app.vault.adapter.stat(candidate);
      if (!cached && !diskEntry) return candidate;
    }
    throw new Error(`Could not create a unique project folder for ${name}.`);
  }

  private async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const parts = normalized.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (!existing) {
        const diskEntry = await this.app.vault.adapter.stat(current);
        if (diskEntry?.type === "folder") continue;
        if (diskEntry) throw new Error(`A file blocks the folder path ${current}.`);
        try {
          await this.app.vault.createFolder(current);
        } catch (error) {
          const afterCreate = await this.app.vault.adapter.stat(current);
          if (afterCreate?.type !== "folder") throw error;
        }
      } else if (!(existing instanceof TFolder)) {
        throw new Error(`A file blocks the folder path ${current}.`);
      }
    }
  }

  private async rollbackTaskWorkspaces(taskIds: Set<string>): Promise<void> {
    const settings = this.getSettings();
    const roots = [
      `${normalizePath(settings.activeRoot)}/`,
      `${normalizePath(settings.archiveRoot)}/`
    ];
    const folders = new Map<string, TFolder>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.name !== "task.md" || !roots.some((root) => file.path.startsWith(root))) continue;
      try {
        const document = parseTaskMarkdown(await this.app.vault.read(file));
        if (taskIds.has(document.record.task_id) && file.parent) {
          folders.set(file.parent.path, file.parent);
        }
      } catch {
        // An unrelated invalid task file must not prevent rollback of this batch.
      }
    }
    for (const folder of [...folders.values()].reverse()) {
      await this.app.vault.delete(folder, true);
    }
  }
}

function buildTaskBody(record: TaskRecord, details: string, outcome: string): string {
  const source = record.source_type === "email"
    ? (record.source_title ? `Email subject: ${record.source_title}` : "Email source: subject unavailable")
    : record.source_url
      ? `[${record.source_title || record.source_url}](${record.source_url})`
      : record.source_title;
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
    source,
    "",
    "## Related files",
    "",
    ""
  ].join("\n").replace(/\n{3,}/g, "\n\n");
}

function normalizeSearch(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function projectIndexKey(name: string, archived: boolean): string {
  return `${archived ? "archived" : "active"}:${normalizeSearch(name)}`;
}
