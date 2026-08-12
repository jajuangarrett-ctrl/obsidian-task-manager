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
  taskArtifactFilesPath,
  taskArtifactFolderPath,
  taskArtifactNotePath,
  taskArtifactUpdatesPath,
  taskFilesFolderPath,
  taskFolderPath,
  taskNoteFilePath,
  taskNotesFolderPath,
  taskUpdateFilePath,
  taskUpdatesFolderPath,
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
  legacyWorkspace: boolean;
}

export interface IndexedProject {
  record: ProjectRecord;
  folderPath: string;
  projectFile: TFile;
  archived: boolean;
}

export interface TaskCopyFolder {
  folderPath: string;
  projectName: string;
}

export interface TaskArtifactMigrationPreview {
  taskId: string;
  title: string;
  from: string;
  to: string;
  eligible: boolean;
  reason?: string;
}

export interface TaskArtifactMigrationResult {
  migrated: number;
  attachmentMoves: number;
  skippedShared: string[];
  errors: Array<{ taskId: string; message: string }>;
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
    await this.ensureWorkspaceFolders(settings.inboxRoot);
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
    const inboxPrefix = `${normalizePath(settings.inboxRoot)}/`;
    const archivePrefix = `${normalizePath(settings.archiveRoot)}/`;
    const projectPrefix = `${normalizePath(settings.projectRoot)}/`;
    const projectArchivePrefix = `${normalizePath(settings.projectArchiveRoot)}/`;
    const next = new Map<string, IndexedTask>();
    const nextProjects = new Map<string, IndexedProject>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const legacyWorkspace = file.name === "task.md"
        && (file.path.startsWith(activePrefix) || file.path.startsWith(archivePrefix));
      const projectTask = file.path.startsWith(projectPrefix) && file.path.includes("/Tasks/");
      const inboxTask = file.path.startsWith(inboxPrefix) && file.path.includes("/Tasks/");
      const archivedTask = file.path.startsWith(archivePrefix) && file.path.includes("/Tasks/");
      if (legacyWorkspace || projectTask || inboxTask || archivedTask) {
        try {
          const document = parseTaskMarkdown(await this.app.vault.cachedRead(file));
          if (next.has(document.record.task_id)) throw new Error(`Duplicate task ID ${document.record.task_id}`);
          const folderPath = legacyWorkspace
            ? file.parent?.path || ""
            : workspaceRootFromTaskPath(file.path);
          const updatePath = legacyWorkspace
            ? updatesFilePath(folderPath)
            : usesTaskArtifactLayout(file)
              ? taskArtifactUpdatesPath(folderPath, document.record.task_id)
              : `${taskUpdatesFolderPath(folderPath)}/${file.name}`;
          const updateFile = this.app.vault.getAbstractFileByPath(updatePath);
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
            archived: file.path.startsWith(archivePrefix),
            legacyWorkspace
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
      const referencedPaths = new Set(task.record.related_files.map((path) => normalizePath(path)));
      const related = vaultFiles
        .filter((file) => referencedPaths.has(normalizePath(file.path)))
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
    await this.ensureWorkspaceFolders(folderPath);
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

  copyFolderForTask(taskId: string): TaskCopyFolder {
    const task = this.getById(taskId);
    const projectName = task.record.project.trim();
    if (projectName) {
      const project = this.listProjects({ includeArchived: true }).find((candidate) => {
        return normalizeSearch(candidate.record.name) === normalizeSearch(projectName);
      });
      if (project) {
        return {
          folderPath: project.folderPath,
          projectName: project.record.name
        };
      }
    }
    return {
      folderPath: task.folderPath,
      projectName: ""
    };
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
    const exact = this.list({ includeArchived: true }).find((task) => {
      return file.path === task.taskFile.path || file.path === task.updatesFile?.path;
    });
    if (exact) return exact;
    const related = this.list({ includeArchived: true }).filter((task) => {
      return task.relatedFiles.some((entry) => entry.file.path === file.path);
    });
    return related.length === 1 ? related[0] : null;
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
    const folderPath = await this.workspaceForRecord(record);
    await this.ensureWorkspaceFolders(folderPath);
    const paths = await this.availableTaskPaths(folderPath, record);
    const taskPath = paths.taskPath;
    const updatesPath = paths.updatesPath;
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
    } catch (error) {
      if (taskFile) await this.app.vault.delete(taskFile, true);
      const updateFile = this.app.vault.getAbstractFileByPath(updatesPath);
      if (updateFile instanceof TFile) await this.app.vault.delete(updateFile, true);
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
    const filesPath = this.relatedFilesPath(task);
    await this.ensureFolder(filesPath);
    const fileName = task.legacyWorkspace || task.record.project || usesTaskArtifactLayout(task.taskFile)
      ? `${cleanTitle}.md`
      : `${sanitizeTitleForPath(task.record.title)} - ${cleanTitle}.md`;
    const path = await this.availableFilePath(filesPath, fileName);
    const body = [`# ${cleanTitle}`, "", content.trim(), ""].join("\n").replace(/\n{3,}/g, "\n\n");
    const file = await this.app.vault.create(path, body);
    try {
      await this.addRelatedFileReference(task, file.path);
    } catch (error) {
      await this.app.vault.delete(file, true);
      throw error;
    }
    await this.refresh();
    return file;
  }

  async importRelatedFiles(taskId: string, files: File[]): Promise<TFile[]> {
    const task = this.getById(taskId);
    const attachmentsPath = this.relatedFilesPath(task);
    await this.ensureFolder(attachmentsPath);
    const created: TFile[] = [];
    for (const source of files) {
      const name = safeRelatedFileName(source.name, "Attachment");
      const fileName = task.legacyWorkspace || task.record.project || usesTaskArtifactLayout(task.taskFile)
        ? name
        : `${sanitizeTitleForPath(task.record.title)} - ${name}`;
      const path = await this.availableFilePath(attachmentsPath, fileName);
      const file = await this.app.vault.createBinary(path, await source.arrayBuffer());
      try {
        await this.addRelatedFileReference(task, file.path);
        created.push(file);
      } catch (error) {
        await this.app.vault.delete(file, true);
        throw error;
      }
    }
    await this.refresh();
    return created;
  }

  async availableAttachmentPath(taskId: string, fileName: string, preferredPath = ""): Promise<string> {
    const task = this.getById(taskId);
    const attachmentsPath = this.relatedFilesPath(task);
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
    const name = task.legacyWorkspace || task.record.project || usesTaskArtifactLayout(task.taskFile)
      ? fileName || "Email.md"
      : `${sanitizeTitleForPath(task.record.title)} - ${fileName || "Email.md"}`;
    if (name.includes("/") || name.includes("\\")) {
      throw new Error("The Gmail email filename must not contain a folder path.");
    }
    return this.availableFilePath(attachmentsPath, name);
  }

  async moveVaultFileToTaskAttachments(taskId: string, source: TFile, targetPath: string): Promise<TFile> {
    const task = this.getById(taskId);
    const attachmentsPath = this.relatedFilesPath(task);
    const normalizedTarget = normalizePath(targetPath);
    if (!normalizedTarget.startsWith(`${attachmentsPath}/`)) {
      throw new Error("The Gmail attachment destination is outside the task attachments folder.");
    }
    if (this.app.vault.getAbstractFileByPath(normalizedTarget) || await this.app.vault.adapter.stat(normalizedTarget)) {
      throw new Error(`The Gmail attachment destination already exists: ${normalizedTarget}`);
    }
    const originalSourcePath = source.path;
    await this.app.fileManager.renameFile(source, normalizedTarget);
    const moved = this.app.vault.getAbstractFileByPath(normalizedTarget);
    if (!(moved instanceof TFile)) {
      throw new Error(`The moved Gmail email was not found at ${normalizedTarget}.`);
    }
    try {
      await this.addRelatedFileReference(task, moved.path);
    } catch (error) {
      await this.app.fileManager.renameFile(moved, originalSourcePath);
      throw error;
    }
    await this.refresh();
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
    const transitionedRecord = transitionTaskRecord(taskDocument.record, status, at);
    const nextRecord = task.archived && status !== "archived"
      ? await this.recordForReopen(transitionedRecord)
      : transitionedRecord;
    const updatesFile = await this.ensureUpdatesFile(task);
    const oldUpdates = await this.app.vault.read(updatesFile);
    const type = status === "completed" ? "completed" : status === "archived" ? "archived" : task.record.status === "archived" ? "reopened" : "status-change";
    const nextUpdates = appendUpdateMarkdown(oldUpdates, {
      actor,
      type,
      text: text || (
        transitionedRecord.project && !nextRecord.project
          ? `Status changed from ${task.record.status} to ${status}. The previous project is not active, so the task returned to Inbox.`
          : `Status changed from ${task.record.status} to ${status}.`
      ),
      previousStatus: task.record.status,
      newStatus: status,
      createdAt: at.toISOString()
    });
    try {
      await this.app.vault.modify(updatesFile, nextUpdates);
      await this.app.vault.modify(task.taskFile, renderTaskMarkdown(nextRecord, taskDocument.body));
      if (status === "archived" && !task.archived) {
        await this.moveTaskFiles(task, await this.archiveWorkspace(), nextRecord, { includeRelatedFiles: true });
      } else if (task.archived && status !== "archived") {
        await this.moveTaskFiles(task, await this.workspaceForRecord(nextRecord), nextRecord, { includeRelatedFiles: true });
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
    const project = nextProject ? this.getProjectByName(nextProject) : null;
    const canonicalProject = project?.record.name || "";
    if (task.record.project.trim() === canonicalProject) return task;

    const at = new Date();
    const oldTaskContent = await this.app.vault.read(task.taskFile);
    const taskDocument = parseTaskMarkdown(oldTaskContent);
    const targetWorkspace = !task.archived
      ? await this.workspaceForRecord({ ...taskDocument.record, project: canonicalProject })
      : "";
    const relatedMoves = !task.archived
      ? await this.relatedFileMovesForProjectChange(task, targetWorkspace)
      : [];
    const relatedPaths = new Map(relatedMoves.map((move) => [normalizePath(move.from), move.to]));
    const nextRecord = updateTaskFields(taskDocument.record, {
      project: canonicalProject,
      related_files: taskDocument.record.related_files.map((path) => relatedPaths.get(normalizePath(path)) || path)
    }, at);
    const updatesFile = await this.ensureUpdatesFile(task);
    const oldUpdates = await this.app.vault.read(updatesFile);
    const previous = task.record.project.trim() || "No project";
    const next = canonicalProject || "No project";
    const nextUpdates = appendUpdateMarkdown(oldUpdates, {
      actor,
      type: "fields-changed",
      text: `Project changed from ${previous} to ${next}.`,
      createdAt: at.toISOString()
    });

    try {
      await this.app.vault.modify(updatesFile, nextUpdates);
      await this.app.vault.modify(task.taskFile, renderTaskMarkdown(nextRecord, taskDocument.body));
      if (!task.archived) {
        await this.moveTaskFiles(task, targetWorkspace, nextRecord, { relatedMoves });
      }
    } catch (error) {
      // TFile references survive Obsidian renames. Use them directly so a
      // failed multi-file move can restore content even after a partial rename.
      await this.app.vault.modify(task.taskFile, oldTaskContent);
      await this.app.vault.modify(updatesFile, oldUpdates);
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
        if (!task.updatesFile) issues.push("Task update log is missing.");
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

  private async addRelatedFileReference(task: IndexedTask, path: string): Promise<void> {
    const current = await this.app.vault.read(task.taskFile);
    const document = parseTaskMarkdown(current);
    const normalizedPath = normalizePath(path);
    if (document.record.related_files.some((entry) => normalizePath(entry) === normalizedPath)) return;
    const next = updateTaskFields(document.record, {
      related_files: [...document.record.related_files, normalizedPath]
    });
    await this.app.vault.modify(task.taskFile, renderTaskMarkdown(next, document.body));
  }

  private async ensureUpdatesFile(task: IndexedTask): Promise<TFile> {
    if (task.updatesFile) return task.updatesFile;
    if (task.legacyWorkspace) {
      return this.app.vault.create(updatesFilePath(task.folderPath), renderUpdatesMarkdown());
    }
    if (usesTaskArtifactLayout(task.taskFile)) {
      const folder = taskArtifactFolderPath(task.folderPath, "Updates", task.record.task_id);
      await this.ensureFolder(folder);
      return this.app.vault.create(taskArtifactUpdatesPath(task.folderPath, task.record.task_id), renderUpdatesMarkdown());
    }
    await this.ensureFolder(taskUpdatesFolderPath(task.folderPath));
    return this.app.vault.create(
      `${taskUpdatesFolderPath(task.folderPath)}/${task.taskFile.name}`,
      renderUpdatesMarkdown()
    );
  }

  private async workspaceForRecord(record: TaskRecord): Promise<string> {
    if (record.status === "archived") return this.archiveWorkspace();
    const projectName = record.project.trim();
    if (!projectName) return normalizePath(this.getSettings().inboxRoot);
    return this.getProjectByName(projectName).folderPath;
  }

  private async archiveWorkspace(): Promise<string> {
    return normalizePath(this.getSettings().archiveRoot);
  }

  private async recordForReopen(record: TaskRecord): Promise<TaskRecord> {
    if (!record.project.trim()) return record;
    const activeProject = this.listProjects().find((project) => {
      return normalizeSearch(project.record.name) === normalizeSearch(record.project);
    });
    return activeProject
      ? { ...record, project: activeProject.record.name }
      : { ...record, project: "" };
  }

  private async relatedFileMovesForProjectChange(
    task: IndexedTask,
    targetWorkspace: string
  ): Promise<Array<{ file: TFile; from: string; to: string }>> {
    const filesPath = this.relatedFilesPathForWorkspace(targetWorkspace, task.record, usesTaskArtifactLayout(task.taskFile), task.legacyWorkspace);
    await this.ensureFolder(filesPath);
    const moves: Array<{ file: TFile; from: string; to: string }> = [];
    for (const related of task.relatedFiles) {
      const normalizedPath = normalizePath(related.file.path);
      const referenceCount = this.list({ includeArchived: true })
        .filter((candidate) => candidate.record.related_files.some((path) => normalizePath(path) === normalizedPath))
        .length;
      // A shared attachment stays put so every task keeps a valid reference.
      if (referenceCount > 1) continue;
      moves.push({
        file: related.file,
        from: related.file.path,
        to: await this.availableFilePath(filesPath, related.file.name)
      });
    }
    return moves;
  }

  private async moveTaskFiles(
    task: IndexedTask,
    targetWorkspace: string,
    record: TaskRecord,
    options: {
      includeRelatedFiles?: boolean;
      relatedMoves?: Array<{ file: TFile; from: string; to: string }>;
    } = {}
  ): Promise<void> {
    const normalizedTarget = normalizePath(targetWorkspace);
    await this.ensureWorkspaceFolders(normalizedTarget);
    if (!task.legacyWorkspace && normalizePath(task.folderPath) === normalizedTarget) return;
    const updatesFile = await this.ensureUpdatesFile(task);
    const paths = await this.availableTaskPaths(normalizedTarget, record, task.taskFile.path);
    const moves: Array<{ file: TFile; from: string; to: string }> = [
      { file: updatesFile, from: updatesFile.path, to: paths.updatesPath },
      { file: task.taskFile, from: task.taskFile.path, to: paths.taskPath }
    ];
    if (options.relatedMoves) {
      moves.unshift(...options.relatedMoves);
    } else if (options.includeRelatedFiles === true) {
      const filesPath = this.relatedFilesPathForWorkspace(normalizedTarget, record, usesTaskArtifactLayout(task.taskFile), task.legacyWorkspace);
      await this.ensureFolder(filesPath);
      for (const related of task.relatedFiles) {
        const prefix = usesTaskArtifactLayout(task.taskFile) ? "" : `${sanitizeTitleForPath(record.title)} - `;
        const name = related.file.name.startsWith(prefix)
          ? related.file.name
          : `${prefix}${related.file.name}`;
        moves.unshift({
          file: related.file,
          from: related.file.path,
          to: await this.availableFilePath(filesPath, name)
        });
      }
    }
    const completed: Array<{ file: TFile; from: string }> = [];
    try {
      for (const move of moves) {
        await this.app.fileManager.renameFile(move.file, move.to);
        completed.push({ file: move.file, from: move.from });
      }
    } catch (error) {
      for (const move of completed.reverse()) {
        try {
          await this.app.fileManager.renameFile(move.file, move.from);
        } catch (rollbackError) {
          console.error("[FJG Task Manager] Task move rollback failed", move.file.path, rollbackError);
        }
      }
      throw error;
    }
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
      if (!task.legacyWorkspace) continue;
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

  private async availableTaskPaths(
    workspace: string,
    record: TaskRecord,
    currentTaskPath = ""
  ): Promise<{ taskPath: string; updatesPath: string }> {
    const useArtifactLayout = !currentTaskPath || usesTaskArtifactPath(currentTaskPath);
    if (useArtifactLayout) {
      const taskPath = taskArtifactNotePath(workspace, record.task_id);
      const updatesPath = taskArtifactUpdatesPath(workspace, record.task_id);
      await this.ensureFolder(taskArtifactFolderPath(workspace, "Tasks", record.task_id));
      await this.ensureFolder(taskArtifactFolderPath(workspace, "Updates", record.task_id));
      return { taskPath, updatesPath };
    }
    const tasksFolder = taskNotesFolderPath(workspace);
    const updatesFolder = taskUpdatesFolderPath(workspace);
    await this.ensureFolder(tasksFolder);
    await this.ensureFolder(updatesFolder);
    for (let copyNumber = 1; copyNumber <= 999; copyNumber += 1) {
      const taskPath = normalizePath(taskNoteFilePath(workspace, record.title, copyNumber));
      const updatesPath = normalizePath(taskUpdateFilePath(workspace, record.title, copyNumber));
      if (taskPath === currentTaskPath) return { taskPath, updatesPath };
      const taskEntry = this.app.vault.getAbstractFileByPath(taskPath) || await this.app.vault.adapter.stat(taskPath);
      const updatesEntry = this.app.vault.getAbstractFileByPath(updatesPath) || await this.app.vault.adapter.stat(updatesPath);
      if (!taskEntry && !updatesEntry) return { taskPath, updatesPath };
    }
    throw new Error(`Could not create unique task files for ${record.title}.`);
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

  private async ensureWorkspaceFolders(path: string): Promise<void> {
    await this.ensureFolder(path);
    await this.ensureFolder(taskNotesFolderPath(path));
    await this.ensureFolder(taskUpdatesFolderPath(path));
    await this.ensureFolder(taskFilesFolderPath(path));
  }

  /** Read-only preview. Existing task files are never migrated automatically. */
  previewTaskArtifactMigration(): TaskArtifactMigrationPreview[] {
    return this.list({ includeArchived: true }).map((task) => {
      if (task.legacyWorkspace) {
        return { taskId: task.record.task_id, title: task.record.title, from: task.taskFile.path, to: "", eligible: false, reason: "legacy workspace layout" };
      }
      if (usesTaskArtifactLayout(task.taskFile)) {
        return { taskId: task.record.task_id, title: task.record.title, from: task.taskFile.path, to: task.taskFile.path, eligible: false, reason: "already uses task-specific folders" };
      }
      return { taskId: task.record.task_id, title: task.record.title, from: task.taskFile.path, to: taskArtifactNotePath(task.folderPath, task.record.task_id), eligible: true };
    });
  }

  /**
   * Moves one canonical task at a time into the task-ID layout. Only explicit,
   * uniquely referenced attachments travel with it. Each task is rolled back
   * if any record or file move fails; existing folders are intentionally kept.
   */
  async migrateTaskArtifacts(): Promise<TaskArtifactMigrationResult> {
    const result: TaskArtifactMigrationResult = { migrated: 0, attachmentMoves: 0, skippedShared: [], errors: [] };
    for (const task of this.list({ includeArchived: true })) {
      if (task.legacyWorkspace || usesTaskArtifactLayout(task.taskFile)) continue;
      try {
        const movedAttachments = await this.migrateTaskArtifactLayout(task, result.skippedShared);
        result.migrated += 1;
        result.attachmentMoves += movedAttachments;
        await this.refresh();
      } catch (error) {
        result.errors.push({ taskId: task.record.task_id, message: error instanceof Error ? error.message : String(error) });
        await this.refresh();
      }
    }
    return result;
  }

  private async migrateTaskArtifactLayout(task: IndexedTask, skippedShared: string[]): Promise<number> {
    const paths = await this.availableTaskPaths(task.folderPath, task.record);
    const oldTaskContent = await this.app.vault.read(task.taskFile);
    const updatesFile = task.updatesFile;
    const relatedMoves: Array<{ file: TFile; from: string; to: string }> = [];
    const relatedPaths = new Map<string, string>();
    const filesPath = taskArtifactFilesPath(task.folderPath, task.record.task_id);
    await this.ensureFolder(filesPath);
    for (const related of task.relatedFiles) {
      const from = normalizePath(related.file.path);
      const referenceCount = this.list({ includeArchived: true })
        .filter((candidate) => candidate.record.related_files.some((path) => normalizePath(path) === from)).length;
      if (referenceCount > 1) {
        skippedShared.push(from);
        continue;
      }
      const to = await this.availableFilePath(filesPath, related.file.name);
      relatedMoves.push({ file: related.file, from, to });
      relatedPaths.set(from, to);
    }
    const document = parseTaskMarkdown(oldTaskContent);
    const nextRecord = updateTaskFields(document.record, {
      related_files: document.record.related_files.map((path) => relatedPaths.get(normalizePath(path)) || path)
    });
    const moves: Array<{ file: TFile; from: string; to: string }> = [
      ...relatedMoves,
      ...(updatesFile ? [{ file: updatesFile, from: updatesFile.path, to: paths.updatesPath }] : []),
      { file: task.taskFile, from: task.taskFile.path, to: paths.taskPath }
    ];
    const completed: Array<{ file: TFile; from: string }> = [];
    try {
      for (const move of moves) {
        await this.app.fileManager.renameFile(move.file, move.to);
        completed.push({ file: move.file, from: move.from });
      }
      await this.app.vault.modify(task.taskFile, renderTaskMarkdown(nextRecord, document.body));
      return relatedMoves.length;
    } catch (error) {
      for (const move of completed.reverse()) {
        try {
          await this.app.fileManager.renameFile(move.file, move.from);
        } catch (rollbackError) {
          console.error("[FJG Task Manager] Artifact migration rollback failed", move.file.path, rollbackError);
        }
      }
      const restored = this.app.vault.getAbstractFileByPath(task.taskFile.path);
      if (restored instanceof TFile) await this.app.vault.modify(restored, oldTaskContent);
      throw error;
    }
  }

  private relatedFilesPath(task: IndexedTask): string {
    return this.relatedFilesPathForWorkspace(task.folderPath, task.record, usesTaskArtifactLayout(task.taskFile), task.legacyWorkspace);
  }

  private relatedFilesPathForWorkspace(workspace: string, record: TaskRecord, artifactLayout: boolean, legacyWorkspace: boolean): string {
    if (legacyWorkspace) return normalizePath(`${workspace}/attachments`);
    return artifactLayout ? taskArtifactFilesPath(workspace, record.task_id) : taskFilesFolderPath(workspace);
  }

  private async rollbackTaskWorkspaces(taskIds: Set<string>): Promise<void> {
    const settings = this.getSettings();
    const roots = [
      `${normalizePath(settings.activeRoot)}/`,
      `${normalizePath(settings.archiveRoot)}/`
    ];
    const files: TFile[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const inLegacyRoot = file.name === "task.md" && roots.some((root) => file.path.startsWith(root));
      const inManagedTasks = file.path.includes("/Tasks/");
      if (!inLegacyRoot && !inManagedTasks) continue;
      try {
        const document = parseTaskMarkdown(await this.app.vault.read(file));
        if (taskIds.has(document.record.task_id)) {
          files.push(file);
          const workspace = inLegacyRoot ? file.parent?.path || "" : workspaceRootFromTaskPath(file.path);
          const update = this.app.vault.getAbstractFileByPath(
            inLegacyRoot ? updatesFilePath(workspace) : `${taskUpdatesFolderPath(workspace)}/${file.name}`
          );
          if (update instanceof TFile) files.push(update);
        }
      } catch {
        // An unrelated invalid task file must not prevent rollback of this batch.
      }
    }
    for (const file of [...new Set(files)].reverse()) {
      await this.app.vault.delete(file, true);
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
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function projectIndexKey(name: string, archived: boolean): string {
  return `${archived ? "archived" : "active"}:${normalizeSearch(name)}`;
}

function workspaceRootFromTaskPath(path: string): string {
  const marker = "/Tasks/";
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf(marker);
  if (index < 0) throw new Error(`Task note is outside a managed Tasks folder: ${path}`);
  return normalized.slice(0, index);
}

function usesTaskArtifactLayout(file: TFile): boolean {
  return usesTaskArtifactPath(file.path);
}

function usesTaskArtifactPath(path: string): boolean {
  return /\/Tasks\/[^/]+\/task\.md$/i.test(normalizePath(path));
}
