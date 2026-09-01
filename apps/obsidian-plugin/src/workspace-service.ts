import { App, normalizePath, TFile, TFolder } from "obsidian";
import {
  appendUpdateMarkdown,
  createTaskRecord,
  NewTaskInput,
  normalizeStatus,
  parseTaskMarkdown,
  renameTaskHeading,
  renderTaskMarkdown,
  renderUpdatesMarkdown,
  sanitizeTitleForPath,
  TaskRecord,
  TaskStatus,
  TaskUpdateInput,
  taskFilePath,
  taskArtifactFilesPath,
  taskArtifactFolderName,
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
  queryTaskContext,
  QueryableProject,
  QueryableTask,
  TaskQueryResult
} from "./task-query";
import {
  renderTaskManagerBriefing,
  TASK_BRIEFING_FILE_NAME
} from "./task-briefing";
import {
  archiveProjectRecord,
  createProjectRecord,
  normalizeProjectName,
  parseProjectDocument,
  ProjectRecord,
  renderProjectDocument,
  renameProjectHeading,
  renameProjectRecord,
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
import {
  filterTaskRelocationDestinations,
  isTaskRelocationBundlePath,
  isTaskRelocationDestination,
  isTaskRelocationPath,
  normalizeTaskRelocationDestination,
  taskRelocationCollectionName
} from "./task-relocation";

export interface TaskRelatedFile {
  file: TFile;
  kind: RelatedFileKind;
  preview: string;
}

export interface IndexedTask {
  record: TaskRecord;
  notes: string;
  statusAssigned: boolean;
  folderPath: string;
  taskFile: TFile;
  updatesFile: TFile | null;
  updates: TaskUpdatePreview[];
  relatedFiles: TaskRelatedFile[];
  archived: boolean;
  legacyWorkspace: boolean;
  relocatedBundle: boolean;
}

export interface IndexedProject {
  record: ProjectRecord;
  notes: string;
  folderPath: string;
  projectFile: TFile;
  archived: boolean;
}

export interface TaskCopyFolder {
  folderPath: string;
  legacy: boolean;
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

export interface TaskArtifactFolderRenamePreview {
  taskId: string;
  title: string;
  from: string;
  to: string;
  eligible: boolean;
  reason?: string;
}

export interface ProjectRenameResult {
  project: IndexedProject;
  updatedTaskCount: number;
}

interface TaskRenameMove {
  entry: TFolder;
  from: string;
  to: string;
}

interface TaskProjectMove {
  entry: TFile | TFolder;
  from: string;
  to: string;
  rollbackTo?: string;
}

interface TaskProjectMovePlan {
  moves: TaskProjectMove[];
  pathRewrites: Array<{ from: string; to: string }>;
  foldersToCreate: string[];
  targetLocation: string;
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
      const relocatedTask = isTaskRelocationPath(file.path);
      const relocatedBundle = relocatedTask && isTaskRelocationBundlePath(file.path);
      if (legacyWorkspace || projectTask || inboxTask || archivedTask || relocatedTask) {
        try {
          const document = parseTaskMarkdown(await this.app.vault.cachedRead(file));
          if (next.has(document.record.task_id)) throw new Error(`Duplicate task ID ${document.record.task_id}`);
          const folderPath = legacyWorkspace || relocatedBundle
            ? file.parent?.path || ""
            : workspaceRootFromTaskPath(file.path);
          const updatePath = legacyWorkspace || relocatedBundle
            ? updatesFilePath(folderPath)
            : usesTaskArtifactLayout(file)
              ? taskArtifactUpdatesPath(folderPath, file.parent?.name || document.record.title)
              : `${taskUpdatesFolderPath(folderPath)}/${file.name}`;
          const updateFile = this.app.vault.getAbstractFileByPath(updatePath);
          const updates = updateFile instanceof TFile
            ? parseTaskUpdatePreviews(await this.app.vault.cachedRead(updateFile))
            : [];
          next.set(document.record.task_id, {
            record: document.record,
            notes: document.body,
            statusAssigned: document.statusRecognized,
            folderPath,
            taskFile: file,
            updatesFile: updateFile instanceof TFile ? updateFile : null,
            updates,
            relatedFiles: [],
            archived: file.path.startsWith(archivePrefix),
            legacyWorkspace,
            relocatedBundle
          });
        } catch (error) {
          console.error("[FJG Task Manager] Invalid task workspace", file.path, error);
        }
      } else if (
        file.name === "project.md"
        && (file.path.startsWith(projectPrefix) || file.path.startsWith(projectArchivePrefix))
      ) {
        try {
          const document = parseProjectDocument(await this.app.vault.cachedRead(file));
          const record = document.record;
          const archived = file.path.startsWith(projectArchivePrefix);
          const key = projectIndexKey(record.name, archived);
          if (nextProjects.has(key)) throw new Error(`Duplicate project name ${record.name}`);
          nextProjects.set(key, {
            record: {
              ...record,
              status: archived ? "archived" : "active",
              archived_at: archived ? record.archived_at : ""
            },
            notes: document.body,
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
    try {
      await this.refreshBriefingNote();
    } catch (error) {
      console.error("[FJG Task Manager] Could not refresh Task Manager briefing", error);
    }
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

  listRelocationDestinations(): string[] {
    const folderPaths = this.app.vault.getAllLoadedFiles()
      .filter((entry): entry is TFolder => entry instanceof TFolder)
      .map((folder) => normalizePath(folder.path));
    const folderSet = new Set(folderPaths);
    const internalRoots = folderPaths
      .filter((path) => path.endsWith("/Tasks"))
      .filter((path) => {
        const workspace = path.slice(0, -"/Tasks".length);
        return isTaskRelocationDestination(workspace)
          && folderSet.has(`${workspace}/Updates`)
          && folderSet.has(`${workspace}/Files`);
      })
      .flatMap((path) => {
        const workspace = path.slice(0, -"/Tasks".length);
        return ["Tasks", "Updates", "Files"].map((collection) => `${workspace}/${collection}`);
      });
    internalRoots.push(...this.list({ includeArchived: true })
      .filter((task) => task.relocatedBundle)
      .map((task) => this.relocationCollectionPath(task)));
    return filterTaskRelocationDestinations(folderPaths)
      .filter((path) => !internalRoots.some((root) => path === root || path.startsWith(`${root}/`)));
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
      projectFile = await this.app.vault.create(projectPath, renderProjectMarkdown({ ...record, location: folderPath }, description));
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

  async renameProject(currentName: string, requestedName: string): Promise<ProjectRenameResult> {
    const project = this.getProjectByName(currentName);
    const nextName = normalizeProjectName(requestedName);
    if (!nextName) throw new Error("Enter a project name.");
    if (nextName.length > 120) throw new Error("Project names must be 120 characters or fewer.");
    if (sanitizeTitleForPath(nextName) !== nextName) {
      throw new Error("Project names cannot contain \\, /, :, *, ?, quotes, angle brackets, pipes, #, ^, or brackets.");
    }

    const currentKey = normalizeSearch(project.record.name);
    const nextKey = normalizeSearch(nextName);
    if (nextKey === currentKey) {
      throw new Error("Choose a project name that differs from the current name.");
    }
    const conflictingProject = this.listProjects({ includeArchived: true })
      .find((candidate) => normalizeSearch(candidate.record.name) === nextKey);
    if (conflictingProject) {
      throw new Error(
        `${conflictingProject.archived ? "Archived project" : "Project"} already exists: ${conflictingProject.record.name}`
      );
    }
    const conflictingName = this.projectNames()
      .find((name) => normalizeSearch(name) === nextKey);
    if (conflictingName) throw new Error(`Project already exists: ${conflictingName}`);

    const folder = this.app.vault.getAbstractFileByPath(project.folderPath);
    if (!(folder instanceof TFolder)) throw new Error(`Project folder not found: ${project.folderPath}`);
    const destination = normalizePath(`${parentFolderPath(project.folderPath)}/${nextName}`);
    const destinationEntry = this.app.vault.getAbstractFileByPath(destination)
      || await this.app.vault.adapter.stat(destination);
    if (destinationEntry) throw new Error(`A folder or file already exists at ${destination}.`);

    const affectedTasks = this.list({ includeArchived: true }).filter((task) => {
      const path = normalizePath(task.taskFile.path);
      return normalizeSearch(task.record.project) === currentKey
        || path.startsWith(`${normalizePath(project.folderPath)}/`);
    });
    const originalProjectContent = await this.app.vault.read(project.projectFile);
    const projectDocument = parseProjectDocument(originalProjectContent);
    const taskSnapshots = await Promise.all(affectedTasks.map(async (task) => {
      const content = await this.app.vault.read(task.taskFile);
      return { task, content, document: parseTaskMarkdown(content) };
    }));
    const at = new Date();
    let folderRenamed = false;

    try {
      await this.app.vault.rename(folder, destination);
      folderRenamed = true;

      const nextProjectRecord = renameProjectRecord(projectDocument.record, nextName, destination, at);
      await this.app.vault.modify(
        project.projectFile,
        renderProjectDocument(
          nextProjectRecord,
          renameProjectHeading(projectDocument.body, projectDocument.record.name, nextName)
        )
      );

      for (const snapshot of taskSnapshots) {
        const location = snapshot.task.taskFile.parent?.path;
        if (!location) throw new Error(`Task location could not be resolved: ${snapshot.task.record.title}`);
        const relatedFiles = snapshot.document.record.related_files.map((path) => {
          return replaceVaultPathPrefix(path, project.folderPath, destination);
        });
        const nextRecord = updateTaskFields(snapshot.document.record, {
          project: nextName,
          location,
          related_files: relatedFiles
        }, at);
        await this.app.vault.modify(
          snapshot.task.taskFile,
          renderTaskMarkdown(nextRecord, snapshot.document.body)
        );
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const snapshot of taskSnapshots) {
        try {
          await this.app.vault.modify(snapshot.task.taskFile, snapshot.content);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        }
      }
      try {
        await this.app.vault.modify(project.projectFile, originalProjectContent);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
      }
      if (folderRenamed) {
        try {
          await this.app.vault.rename(folder, project.folderPath);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        }
      }
      await this.refresh();
      if (rollbackErrors.length) {
        throw new Error(`Project rename failed and rollback needs attention: ${rollbackErrors.join("; ")}`);
      }
      throw new Error(`Project rename failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    await this.refresh();
    return {
      project: this.getProjectByName(nextName),
      updatedTaskCount: affectedTasks.length
    };
  }

  async renameTask(taskId: string, requestedTitle: string): Promise<IndexedTask> {
    const task = this.getById(taskId);
    const nextTitle = normalizeTaskTitle(requestedTitle);
    if (!nextTitle) throw new Error("Enter a task name.");
    if (nextTitle.length > 120) throw new Error("Task names must be 120 characters or fewer.");
    if (sanitizeTitleForPath(nextTitle) !== nextTitle) {
      throw new Error("Task names cannot contain \\, /, :, *, ?, quotes, angle brackets, pipes, #, ^, or brackets.");
    }
    if (normalizeSearch(nextTitle) === normalizeSearch(task.record.title)) {
      throw new Error("Choose a task name that differs from the current name.");
    }

    const moves = this.taskRenameMoves(task, nextTitle);
    for (const move of moves) {
      const destinationEntry = this.app.vault.getAbstractFileByPath(move.to)
        || await this.app.vault.adapter.stat(move.to);
      if (destinationEntry) throw new Error(`A task folder already exists at ${move.to}.`);
    }

    const oldContent = await this.app.vault.read(task.taskFile);
    const document = parseTaskMarkdown(oldContent);
    const at = new Date();
    const completed: TaskRenameMove[] = [];
    try {
      for (const move of moves) {
        await this.app.vault.rename(move.entry, move.to);
        completed.push(move);
      }
      const location = task.taskFile.parent?.path;
      if (!location) throw new Error(`Task location could not be resolved: ${task.record.title}`);
      const relatedFiles = document.record.related_files.map((path) => {
        return moves.reduce(
          (current, move) => replaceVaultPathPrefix(current, move.from, move.to),
          path
        );
      });
      const nextRecord = updateTaskFields(document.record, {
        title: nextTitle,
        location,
        related_files: relatedFiles
      }, at);
      await this.app.vault.modify(
        task.taskFile,
        renderTaskMarkdown(
          nextRecord,
          renameTaskHeading(document.body, document.record.title, nextTitle)
        )
      );
    } catch (error) {
      const rollbackErrors: string[] = [];
      try {
        await this.app.vault.modify(task.taskFile, oldContent);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
      }
      for (const move of completed.reverse()) {
        try {
          await this.app.vault.rename(move.entry, move.from);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        }
      }
      await this.refresh();
      if (rollbackErrors.length) {
        throw new Error(`Task rename failed and rollback needs attention: ${rollbackErrors.join("; ")}`);
      }
      throw new Error(`Task rename failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    await this.refresh();
    return this.getById(taskId);
  }

  copyFolderForTask(taskId: string): TaskCopyFolder {
    const task = this.getById(taskId);
    return {
      // Copy Path is an attachment destination, never the shared workspace root.
      folderPath: this.relatedFilesPath(task),
      legacy: task.legacyWorkspace
    };
  }

  relocationLocationForTask(taskId: string): string {
    const task = this.getById(taskId);
    if (!task.relocatedBundle) return task.folderPath;
    const collectionPath = parentFolderPath(task.folderPath);
    const destination = parentFolderPath(collectionPath);
    return isTaskRelocationDestination(destination)
      && collectionPath === normalizePath(`${destination}/${taskRelocationCollectionName(destination)}`)
      ? destination
      : collectionPath;
  }

  async ensureFilesFolderForTask(taskId: string): Promise<TaskCopyFolder> {
    const destination = this.copyFolderForTask(taskId);
    await this.ensureFolder(destination.folderPath);
    return destination;
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

  queryForClaudian(question: string, now = new Date(), limit = 30): TaskQueryResult {
    const { tasks, projects } = this.querySources();
    return queryTaskContext(tasks, projects, question, now, limit);
  }

  briefingPath(): string {
    return normalizePath(`${this.getSettings().activeRoot}/${TASK_BRIEFING_FILE_NAME}`);
  }

  isBriefingPath(value: string): boolean {
    return normalizePath(value) === this.briefingPath();
  }

  async refreshBriefingNote(generatedAt = new Date()): Promise<TFile> {
    const path = this.briefingPath();
    const { tasks, projects } = this.querySources();
    const markdown = renderTaskManagerBriefing(tasks, projects, generatedAt);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, markdown);
      return existing;
    }
    if (existing) throw new Error(`Task briefing path is not a file: ${path}`);
    return this.app.vault.create(path, markdown);
  }

  getById(taskId: string): IndexedTask {
    const task = this.index.get(taskId);
    if (!task) throw new Error(`No task matched ID ${taskId}.`);
    return task;
  }

  private querySources(): { tasks: QueryableTask[]; projects: QueryableProject[] } {
    const indexedProjects = this.listProjects({ includeArchived: true });
    const projectPaths = new Map(
      indexedProjects.map((project) => [normalizeSearch(project.record.name), project.projectFile.path])
    );
    return {
      tasks: this.list({ includeArchived: true }).map((task) => ({
        record: task.record,
        notes: task.notes,
        updates: task.updates,
        taskPath: task.taskFile.path,
        updatesPath: task.updatesFile?.path || "",
        projectPath: projectPaths.get(normalizeSearch(task.record.project)) || "",
        archived: task.archived
      })),
      projects: indexedProjects.map((project) => ({
        name: project.record.name,
        status: project.record.status,
        notes: project.notes,
        path: project.projectFile.path
      }))
    };
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
    const filesPath = taskArtifactFilesPath(folderPath, artifactFolderFromTaskPath(taskPath));
    await this.ensureFolder(filesPath);
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
    const sameProject = normalizeSearch(task.record.project) === normalizeSearch(canonicalProject);

    const at = new Date();
    const oldTaskContent = await this.app.vault.read(task.taskFile);
    const taskDocument = parseTaskMarkdown(oldTaskContent);
    const targetWorkspace = await this.workspaceForRecord({ ...taskDocument.record, project: canonicalProject });
    if (
      sameProject
      && (task.relocatedBundle || task.legacyWorkspace || normalizePath(task.folderPath) === normalizePath(targetWorkspace))
    ) return task;

    const updatesFile = await this.ensureUpdatesFile(task);
    const movePlan = await this.projectChangeMovePlan(task, targetWorkspace, updatesFile);
    await this.validateProjectChangeDestinations(movePlan);
    const rewritePath = (path: string) => rewriteVaultPath(path, movePlan.pathRewrites);
    const nextRecord = updateTaskFields(taskDocument.record, {
      project: canonicalProject,
      location: movePlan.targetLocation,
      related_files: taskDocument.record.related_files.map(rewritePath)
    }, at);
    const oldUpdates = await this.app.vault.read(updatesFile);
    const previous = task.record.project.trim() || "No project";
    const next = canonicalProject || "No project";
    const workspaceChanged = movePlan.moves.length > 0;
    const updateText = sameProject
      ? `Task workspace moved to ${movePlan.targetLocation} to match project ${next}.`
      : workspaceChanged
        ? `Project changed from ${previous} to ${next}. Task workspace moved to ${movePlan.targetLocation}.`
        : `Project changed from ${previous} to ${next}.`;
    const nextUpdates = appendUpdateMarkdown(oldUpdates, {
      actor,
      type: "fields-changed",
      text: updateText,
      createdAt: at.toISOString()
    });

    const referenceSnapshots = await this.projectChangeReferenceSnapshots(taskId, movePlan.pathRewrites);
    const createdFolders: TFolder[] = [];
    const completedMoves: TaskProjectMove[] = [];

    try {
      for (const path of movePlan.foldersToCreate) {
        await this.ensureFolder(path);
        const folder = this.app.vault.getAbstractFileByPath(path);
        if (!(folder instanceof TFolder)) throw new Error(`Task destination folder was not created: ${path}`);
        createdFolders.push(folder);
      }
      for (const move of movePlan.moves) {
        if (move.entry instanceof TFolder) await this.app.vault.rename(move.entry, move.to);
        else await this.app.fileManager.renameFile(move.entry, move.to);
        completedMoves.push(move);
      }
      await this.app.vault.modify(updatesFile, nextUpdates);
      await this.app.vault.modify(task.taskFile, renderTaskMarkdown(nextRecord, taskDocument.body));
      for (const snapshot of referenceSnapshots) {
        const relatedFiles = snapshot.document.record.related_files.map(rewritePath);
        await this.app.vault.modify(
          snapshot.task.taskFile,
          renderTaskMarkdown(
            updateTaskFields(snapshot.document.record, { related_files: relatedFiles }, at),
            snapshot.document.body
          )
        );
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const snapshot of referenceSnapshots) {
        try {
          await this.app.vault.modify(snapshot.task.taskFile, snapshot.content);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        }
      }
      try {
        await this.app.vault.modify(task.taskFile, oldTaskContent);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
      }
      try {
        await this.app.vault.modify(updatesFile, oldUpdates);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
      }
      for (const move of completedMoves.reverse()) {
        try {
          const target = move.rollbackTo || move.from;
          if (move.entry instanceof TFolder) await this.app.vault.rename(move.entry, target);
          else await this.app.fileManager.renameFile(move.entry, target);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        }
      }
      for (const folder of createdFolders.reverse()) {
        try {
          if (this.folderIsEmpty(folder.path)) await this.app.vault.delete(folder, true);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        }
      }
      await this.refresh();
      if (rollbackErrors.length) {
        throw new Error(`Task project change failed and rollback needs attention: ${rollbackErrors.join("; ")}`);
      }
      throw new Error(`Task project change failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    await this.refresh();
    return this.getById(taskId);
  }

  async relocateTask(
    taskId: string,
    destinationPath: string,
    actor = "Franklin"
  ): Promise<IndexedTask> {
    const task = this.getById(taskId);
    if (task.archived || task.record.status === "archived") {
      throw new Error("Reopen the task before moving it to Programs or Areas.");
    }
    const destination = normalizeTaskRelocationDestination(destinationPath);
    const destinationFolder = this.app.vault.getAbstractFileByPath(destination);
    if (!(destinationFolder instanceof TFolder)) {
      throw new Error(`Destination folder not found: ${destination}`);
    }
    const currentLocation = this.relocationLocationForTask(taskId);
    if (task.relocatedBundle && normalizePath(currentLocation) === destination) {
      throw new Error("This task is already in that folder.");
    }

    const oldTaskContent = await this.app.vault.read(task.taskFile);
    const taskDocument = parseTaskMarkdown(oldTaskContent);
    const updatesFile = await this.ensureUpdatesFile(task);
    const oldUpdates = await this.app.vault.read(updatesFile);
    if (task.legacyWorkspace || task.relocatedBundle || usesTaskArtifactLayout(task.taskFile)) {
      return this.relocateManagedTaskWorkspace({
        task,
        destination,
        currentLocation,
        actor,
        taskDocument,
        oldTaskContent,
        updatesFile,
        oldUpdates
      });
    }

    const paths = await this.availableRelocationPaths(destination, taskDocument.record);
    const targetFilesRoot = paths.filesPath;
    const relatedMoves: Array<{ file: TFile; from: string; to: string }> = [];
    const relatedPaths = new Map<string, string>();
    for (const related of task.relatedFiles) {
      const from = normalizePath(related.file.path);
      const sharedWithAnotherTask = this.list({ includeArchived: true }).some((candidate) => {
        return candidate.record.task_id !== task.record.task_id
          && candidate.record.related_files.some((path) => normalizePath(path) === from);
      });
      if (sharedWithAnotherTask) continue;
      const to = normalizePath(`${targetFilesRoot}/${related.file.name}`);
      if (this.app.vault.getAbstractFileByPath(to) || await this.app.vault.adapter.stat(to)) {
        throw new Error(`Task file destination already exists: ${to}`);
      }
      relatedMoves.push({ file: related.file, from, to });
      relatedPaths.set(from, to);
    }

    const at = new Date();
    const nextRecord = updateTaskFields(taskDocument.record, {
      location: paths.bundlePath,
      related_files: taskDocument.record.related_files.map((path) => {
        return relatedPaths.get(normalizePath(path)) || path;
      })
    }, at);
    const nextUpdates = appendUpdateMarkdown(oldUpdates, {
      actor,
      type: "fields-changed",
      text: `Task relocated from ${currentLocation} to ${destination}.`,
      createdAt: at.toISOString()
    });
    const moves: Array<{ file: TFile; from: string; to: string }> = [
      ...relatedMoves,
      { file: updatesFile, from: updatesFile.path, to: paths.updatesPath },
      { file: task.taskFile, from: task.taskFile.path, to: paths.taskPath }
    ];
    const completed: Array<{ file: TFile; from: string }> = [];
    const createdFolders: TFolder[] = [];
    try {
      await this.ensureFolder(paths.bundlePath);
      const bundleFolder = this.app.vault.getAbstractFileByPath(paths.bundlePath);
      if (bundleFolder instanceof TFolder) createdFolders.push(bundleFolder);
      await this.ensureFolder(targetFilesRoot);
      const filesFolder = this.app.vault.getAbstractFileByPath(targetFilesRoot);
      if (filesFolder instanceof TFolder) createdFolders.push(filesFolder);
      await this.app.vault.modify(updatesFile, nextUpdates);
      await this.app.vault.modify(task.taskFile, renderTaskMarkdown(nextRecord, taskDocument.body));
      for (const move of moves) {
        await this.app.fileManager.renameFile(move.file, move.to);
        completed.push({ file: move.file, from: move.from });
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const move of completed.reverse()) {
        try {
          await this.app.fileManager.renameFile(move.file, move.from);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        }
      }
      try {
        await this.app.vault.modify(task.taskFile, oldTaskContent);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
      }
      try {
        await this.app.vault.modify(updatesFile, oldUpdates);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
      }
      for (const folder of createdFolders.reverse()) {
        try {
          if (this.folderIsEmpty(folder.path)) await this.app.vault.delete(folder, true);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        }
      }
      await this.refresh();
      if (rollbackErrors.length) {
        throw new Error(`Task relocation failed and rollback needs attention: ${rollbackErrors.join("; ")}`);
      }
      throw new Error(`Task relocation failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    await this.refresh();
    return this.getById(taskId);
  }

  private async relocateManagedTaskWorkspace(input: {
    task: IndexedTask;
    destination: string;
    currentLocation: string;
    actor: string;
    taskDocument: ReturnType<typeof parseTaskMarkdown>;
    oldTaskContent: string;
    updatesFile: TFile;
    oldUpdates: string;
  }): Promise<IndexedTask> {
    const {
      task,
      destination,
      currentLocation,
      actor,
      taskDocument,
      oldTaskContent,
      updatesFile,
      oldUpdates
    } = input;
    const targetBundle = (await this.availableRelocationPaths(destination, taskDocument.record)).bundlePath;
    const targetFiles = normalizePath(`${targetBundle}/Files`);
    const moves: TaskProjectMove[] = [];
    const pathRewrites: Array<{ from: string; to: string }> = [];
    let movedUpdatesFolderPath = "";

    if (task.legacyWorkspace || task.relocatedBundle) {
      const sourceRoot = normalizePath(task.folderPath);
      const sourceFolder = this.app.vault.getAbstractFileByPath(sourceRoot);
      if (!(sourceFolder instanceof TFolder)) throw new Error(`Task folder not found: ${sourceRoot}`);
      moves.push({ entry: sourceFolder, from: sourceRoot, to: targetBundle });

      if (task.legacyWorkspace) {
        const sourceAttachments = normalizePath(`${sourceRoot}/attachments`);
        const attachments = this.app.vault.getAbstractFileByPath(sourceAttachments);
        const sourceFiles = this.app.vault.getAbstractFileByPath(`${sourceRoot}/Files`);
        if (attachments && !(attachments instanceof TFolder)) {
          throw new Error(`A file blocks the legacy task attachment folder ${sourceAttachments}.`);
        }
        if (attachments instanceof TFolder && sourceFiles) {
          throw new Error("The legacy task contains both attachments and Files folders; merge them before moving the task.");
        }
        if (attachments instanceof TFolder) {
          moves.push({
            entry: attachments,
            from: sourceAttachments,
            to: targetFiles,
            rollbackTo: normalizePath(`${targetBundle}/attachments`)
          });
          pathRewrites.push({ from: sourceAttachments, to: targetFiles });
        }
      }
      pathRewrites.push({ from: sourceRoot, to: targetBundle });
    } else {
      const artifactName = artifactFolderNameForTask(task);
      const sourceTaskRoot = taskArtifactFolderPath(task.folderPath, "Tasks", artifactName);
      const sourceUpdatesRoot = taskArtifactFolderPath(task.folderPath, "Updates", artifactName);
      const sourceFilesRoot = taskArtifactFolderPath(task.folderPath, "Files", artifactName);
      const taskFolder = this.app.vault.getAbstractFileByPath(sourceTaskRoot);
      const updatesFolder = this.app.vault.getAbstractFileByPath(sourceUpdatesRoot);
      const filesFolder = this.app.vault.getAbstractFileByPath(sourceFilesRoot);
      if (!(taskFolder instanceof TFolder)) throw new Error(`Task folder not found: ${sourceTaskRoot}`);
      if (updatesFolder && !(updatesFolder instanceof TFolder)) {
        throw new Error(`A file blocks the task Updates folder path ${sourceUpdatesRoot}.`);
      }
      if (filesFolder && !(filesFolder instanceof TFolder)) {
        throw new Error(`A file blocks the task Files folder path ${sourceFilesRoot}.`);
      }
      if (updatesFolder && this.app.vault.getAbstractFileByPath(`${sourceTaskRoot}/Updates`)) {
        throw new Error("The task folder already contains an Updates item; rename it before moving the task.");
      }
      if (filesFolder && this.app.vault.getAbstractFileByPath(`${sourceTaskRoot}/Files`)) {
        throw new Error("The task folder already contains a Files item; merge or rename it before moving the task.");
      }
      if (this.app.vault.getAbstractFileByPath(`${sourceTaskRoot}/${updatesFile.name}`)) {
        throw new Error(`The task folder already contains ${updatesFile.name}; merge or rename it before moving the task.`);
      }

      moves.push({ entry: taskFolder, from: sourceTaskRoot, to: targetBundle });
      pathRewrites.push({ from: sourceTaskRoot, to: targetBundle });
      if (filesFolder instanceof TFolder) {
        moves.push({ entry: filesFolder, from: sourceFilesRoot, to: targetFiles });
        pathRewrites.unshift({ from: sourceFilesRoot, to: targetFiles });
      }
      if (updatesFolder instanceof TFolder) {
        movedUpdatesFolderPath = normalizePath(`${targetBundle}/Updates`);
        moves.push({ entry: updatesFolder, from: sourceUpdatesRoot, to: movedUpdatesFolderPath });
        moves.push({
          entry: updatesFile,
          from: updatesFile.path,
          to: normalizePath(`${targetBundle}/${updatesFile.name}`),
          rollbackTo: normalizePath(`${movedUpdatesFolderPath}/${updatesFile.name}`)
        });
        pathRewrites.unshift(
          { from: updatesFile.path, to: normalizePath(`${targetBundle}/${updatesFile.name}`) },
          { from: sourceUpdatesRoot, to: movedUpdatesFolderPath }
        );
      }
    }

    const destinations = new Set<string>();
    for (const move of moves) {
      const target = normalizePath(move.to);
      if (destinations.has(target)) throw new Error(`Task destination is ambiguous: ${target}`);
      destinations.add(target);
      if (this.app.vault.getAbstractFileByPath(target) || await this.app.vault.adapter.stat(target)) {
        throw new Error(`Task destination already exists: ${target}`);
      }
    }

    const rewritePath = (path: string) => rewriteVaultPath(path, pathRewrites);
    const at = new Date();
    const nextRecord = updateTaskFields(taskDocument.record, {
      location: targetBundle,
      related_files: taskDocument.record.related_files.map(rewritePath)
    }, at);
    const nextUpdates = appendUpdateMarkdown(oldUpdates, {
      actor,
      type: "fields-changed",
      text: `Task relocated from ${currentLocation} to ${destination}.`,
      createdAt: at.toISOString()
    });
    const referenceSnapshots = await this.projectChangeReferenceSnapshots(task.record.task_id, pathRewrites);
    const completed: TaskProjectMove[] = [];
    const createdFolders: TFolder[] = [];

    try {
      await this.app.vault.modify(updatesFile, nextUpdates);
      await this.app.vault.modify(task.taskFile, renderTaskMarkdown(nextRecord, taskDocument.body));
      for (const snapshot of referenceSnapshots) {
        const relatedFiles = snapshot.document.record.related_files.map(rewritePath);
        await this.app.vault.modify(
          snapshot.task.taskFile,
          renderTaskMarkdown(
            updateTaskFields(snapshot.document.record, { related_files: relatedFiles }, at),
            snapshot.document.body
          )
        );
      }
      for (const move of moves) {
        if (move.entry instanceof TFolder) await this.app.vault.rename(move.entry, move.to);
        else await this.app.fileManager.renameFile(move.entry, move.to);
        completed.push(move);
      }
      if (!this.app.vault.getAbstractFileByPath(targetFiles)) {
        await this.ensureFolder(targetFiles);
        const folder = this.app.vault.getAbstractFileByPath(targetFiles);
        if (folder instanceof TFolder) createdFolders.push(folder);
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const folder of createdFolders.reverse()) {
        try {
          if (this.folderIsEmpty(folder.path)) await this.app.vault.delete(folder, true);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        }
      }
      for (const move of completed.reverse()) {
        try {
          const rollbackTarget = move.rollbackTo || move.from;
          if (move.entry instanceof TFolder) await this.app.vault.rename(move.entry, rollbackTarget);
          else await this.app.fileManager.renameFile(move.entry, rollbackTarget);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        }
      }
      for (const snapshot of referenceSnapshots) {
        try {
          await this.app.vault.modify(snapshot.task.taskFile, snapshot.content);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        }
      }
      try {
        await this.app.vault.modify(task.taskFile, oldTaskContent);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
      }
      try {
        await this.app.vault.modify(updatesFile, oldUpdates);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
      }
      await this.refresh();
      if (rollbackErrors.length) {
        throw new Error(`Task relocation failed and rollback needs attention: ${rollbackErrors.join("; ")}`);
      }
      throw new Error(`Task relocation failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (movedUpdatesFolderPath) {
      const movedUpdatesFolder = this.app.vault.getAbstractFileByPath(movedUpdatesFolderPath);
      if (movedUpdatesFolder instanceof TFolder && this.folderIsEmpty(movedUpdatesFolder.path)) {
        try {
          await this.app.vault.delete(movedUpdatesFolder, true);
        } catch (error) {
          console.warn("[FJG Task Manager] Could not remove empty relocated Updates folder", error);
        }
      }
    }
    await this.refresh();
    return this.getById(task.record.task_id);
  }

  async changeDueDate(
    taskId: string,
    dueDate: string,
    actor = "Franklin"
  ): Promise<IndexedTask> {
    const task = this.getById(taskId);
    const at = new Date();
    const oldTaskContent = await this.app.vault.read(task.taskFile);
    const taskDocument = parseTaskMarkdown(oldTaskContent);
    const nextRecord = updateTaskFields(taskDocument.record, { due: dueDate }, at);
    if (nextRecord.due === taskDocument.record.due) return task;

    const updatesFile = await this.ensureUpdatesFile(task);
    const oldUpdates = await this.app.vault.read(updatesFile);
    const previous = taskDocument.record.due;
    const nextUpdates = appendUpdateMarkdown(oldUpdates, {
      actor,
      type: "fields-changed",
      text: !previous
        ? `Due date set to ${nextRecord.due}.`
        : !nextRecord.due
          ? `Due date cleared (was ${previous}).`
          : `Due date changed from ${previous} to ${nextRecord.due}.`,
      createdAt: at.toISOString()
    });

    try {
      await this.app.vault.modify(updatesFile, nextUpdates);
      await this.app.vault.modify(task.taskFile, renderTaskMarkdown(nextRecord, taskDocument.body));
    } catch (error) {
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
    if (task.legacyWorkspace || task.relocatedBundle) {
      return this.app.vault.create(updatesFilePath(task.folderPath), renderUpdatesMarkdown());
    }
    if (usesTaskArtifactLayout(task.taskFile)) {
      const folderName = artifactFolderNameForTask(task);
      const folder = taskArtifactFolderPath(task.folderPath, "Updates", folderName);
      await this.ensureFolder(folder);
      return this.app.vault.create(taskArtifactUpdatesPath(task.folderPath, folderName), renderUpdatesMarkdown());
    }
    await this.ensureFolder(taskUpdatesFolderPath(task.folderPath));
    return this.app.vault.create(
      `${taskUpdatesFolderPath(task.folderPath)}/${task.taskFile.name}`,
      renderUpdatesMarkdown()
    );
  }

  private taskRenameMoves(task: IndexedTask, nextTitle: string): TaskRenameMove[] {
    if (task.legacyWorkspace || task.relocatedBundle) {
      const source = this.app.vault.getAbstractFileByPath(task.folderPath);
      if (!(source instanceof TFolder)) throw new Error(`Task folder not found: ${task.folderPath}`);
      return [{
        entry: source,
        from: normalizePath(task.folderPath),
        to: normalizePath(`${parentFolderPath(task.folderPath)}/${nextTitle}`)
      }];
    }
    if (!usesTaskArtifactLayout(task.taskFile)) {
      throw new Error("Migrate this older task to task folders before renaming it.");
    }

    const currentName = artifactFolderNameForTask(task);
    const moves: TaskRenameMove[] = [];
    for (const collection of ["Files", "Updates", "Tasks"]) {
      const from = taskArtifactFolderPath(task.folderPath, collection, currentName);
      const entry = this.app.vault.getAbstractFileByPath(from);
      if (!entry) {
        if (collection === "Tasks") throw new Error(`Task folder not found: ${from}`);
        continue;
      }
      if (!(entry instanceof TFolder)) throw new Error(`A file blocks the task folder path ${from}.`);
      moves.push({
        entry,
        from,
        to: taskArtifactFolderPath(task.folderPath, collection, nextTitle)
      });
    }
    return moves;
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

  private async projectChangeMovePlan(
    task: IndexedTask,
    targetWorkspace: string,
    updatesFile: TFile
  ): Promise<TaskProjectMovePlan> {
    const target = normalizePath(targetWorkspace);
    await this.ensureWorkspaceFolders(target);
    if (!task.legacyWorkspace && !task.relocatedBundle && !usesTaskArtifactLayout(task.taskFile)) {
      throw new Error("Migrate this older task to task folders before changing its project.");
    }

    if (task.relocatedBundle || task.legacyWorkspace) {
      const sourceRoot = normalizePath(task.folderPath);
      const sourceFolder = this.app.vault.getAbstractFileByPath(sourceRoot);
      if (!(sourceFolder instanceof TFolder)) throw new Error(`Task folder not found: ${sourceRoot}`);
      const artifactName = sourceFolder.name;
      const targetTaskFolder = taskArtifactFolderPath(target, "Tasks", artifactName);
      const targetUpdatesFolder = taskArtifactFolderPath(target, "Updates", artifactName);
      const targetFilesFolder = taskArtifactFolderPath(target, "Files", artifactName);
      if (sourceRoot === targetTaskFolder) {
        return { moves: [], pathRewrites: [], foldersToCreate: [], targetLocation: targetTaskFolder };
      }

      const sourceFilesPath = task.legacyWorkspace
        ? normalizePath(`${sourceRoot}/attachments`)
        : normalizePath(`${sourceRoot}/Files`);
      const sourceFiles = this.app.vault.getAbstractFileByPath(sourceFilesPath);
      if (sourceFiles && !(sourceFiles instanceof TFolder)) {
        throw new Error(`A file blocks the task Files folder path ${sourceFilesPath}.`);
      }
      const moves: TaskProjectMove[] = [{
        entry: sourceFolder,
        from: sourceRoot,
        to: targetTaskFolder
      }];
      const foldersToCreate = [targetUpdatesFolder];
      if (sourceFiles instanceof TFolder) {
        moves.push({
          entry: sourceFiles,
          from: sourceFilesPath,
          to: targetFilesFolder,
          rollbackTo: normalizePath(`${targetTaskFolder}/${task.legacyWorkspace ? "attachments" : "Files"}`)
        });
      } else {
        foldersToCreate.push(targetFilesFolder);
      }
      moves.push({
        entry: updatesFile,
        from: updatesFile.path,
        to: taskArtifactUpdatesPath(target, artifactName),
        rollbackTo: normalizePath(`${targetTaskFolder}/${updatesFile.name}`)
      });
      return {
        moves,
        pathRewrites: [
          { from: sourceFilesPath, to: targetFilesFolder },
          { from: sourceRoot, to: targetTaskFolder }
        ],
        foldersToCreate,
        targetLocation: targetTaskFolder
      };
    }

    const artifactName = artifactFolderNameForTask(task);
    const moves: TaskProjectMove[] = [];
    const foldersToCreate: string[] = [];
    const pathRewrites: Array<{ from: string; to: string }> = [];
    for (const collection of ["Files", "Updates", "Tasks"]) {
      const from = taskArtifactFolderPath(task.folderPath, collection, artifactName);
      const to = taskArtifactFolderPath(target, collection, artifactName);
      if (from === to) continue;
      const entry = this.app.vault.getAbstractFileByPath(from);
      if (!entry) {
        if (collection === "Tasks") throw new Error(`Task folder not found: ${from}`);
        foldersToCreate.push(to);
      } else if (!(entry instanceof TFolder)) {
        throw new Error(`A file blocks the task ${collection} folder path ${from}.`);
      } else {
        moves.push({ entry, from, to });
      }
      if (collection === "Files") pathRewrites.push({ from, to });
    }
    return {
      moves,
      pathRewrites,
      foldersToCreate,
      targetLocation: taskArtifactFolderPath(target, "Tasks", artifactName)
    };
  }

  private async validateProjectChangeDestinations(plan: TaskProjectMovePlan): Promise<void> {
    const paths = [...plan.moves.map((move) => move.to), ...plan.foldersToCreate];
    for (const path of paths) {
      const entry = this.app.vault.getAbstractFileByPath(path) || await this.app.vault.adapter.stat(path);
      if (entry) throw new Error(`Task destination already exists: ${path}`);
    }
  }

  private async projectChangeReferenceSnapshots(
    taskId: string,
    rewrites: Array<{ from: string; to: string }>
  ): Promise<Array<{ task: IndexedTask; content: string; document: ReturnType<typeof parseTaskMarkdown> }>> {
    if (!rewrites.length) return [];
    const candidates = this.list({ includeArchived: true }).filter((task) => {
      return task.record.task_id !== taskId
        && task.record.related_files.some((path) => rewriteVaultPath(path, rewrites) !== normalizePath(path));
    });
    return Promise.all(candidates.map(async (task) => {
      const content = await this.app.vault.read(task.taskFile);
      return { task, content, document: parseTaskMarkdown(content) };
    }));
  }

  private folderIsEmpty(path: string): boolean {
    const prefix = `${normalizePath(path)}/`;
    return !this.app.vault.getAllLoadedFiles().some((entry) => normalizePath(entry.path).startsWith(prefix));
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
    if (!task.legacyWorkspace && !task.relocatedBundle && normalizePath(task.folderPath) === normalizedTarget) return;
    const updatesFile = await this.ensureUpdatesFile(task);
    const paths = await this.availableTaskPaths(
      normalizedTarget,
      record,
      task.relocatedBundle ? "" : task.taskFile.path
    );
    const moves: Array<{ file: TFile; from: string; to: string }> = [
      { file: updatesFile, from: updatesFile.path, to: paths.updatesPath },
      { file: task.taskFile, from: task.taskFile.path, to: paths.taskPath }
    ];
    if (options.relatedMoves) {
      moves.unshift(...options.relatedMoves);
    } else if (options.includeRelatedFiles === true) {
      const filesPath = usesTaskArtifactLayout(task.taskFile) || task.relocatedBundle
        ? taskArtifactFilesPath(normalizedTarget, artifactFolderFromTaskPath(paths.taskPath))
        : this.relatedFilesPathForWorkspace(normalizedTarget, record, false, task.legacyWorkspace);
      await this.ensureFolder(filesPath);
      for (const related of task.relatedFiles) {
        const prefix = usesTaskArtifactLayout(task.taskFile) || task.relocatedBundle
          ? ""
          : `${sanitizeTitleForPath(record.title)} - `;
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
      const next = renderProjectDocument({ ...document.record, location: project.folderPath }, document.body);
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
      const folderName = await this.availableArtifactFolderName(workspace, record.title, currentTaskPath);
      const taskPath = taskArtifactNotePath(workspace, folderName);
      const updatesPath = taskArtifactUpdatesPath(workspace, folderName);
      await this.ensureFolder(taskArtifactFolderPath(workspace, "Tasks", folderName));
      await this.ensureFolder(taskArtifactFolderPath(workspace, "Updates", folderName));
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

  private async availableRelocationPaths(
    workspace: string,
    record: TaskRecord
  ): Promise<{ bundlePath: string; taskPath: string; updatesPath: string; filesPath: string }> {
    await this.ensureFolder(workspace);
    const collectionPath = normalizePath(`${workspace}/${taskRelocationCollectionName(workspace)}`);
    await this.ensureFolder(collectionPath);
    for (let copyNumber = 1; copyNumber <= 999; copyNumber += 1) {
      const folderName = taskArtifactFolderName(record.title, copyNumber);
      const bundlePath = normalizePath(`${collectionPath}/${folderName}`);
      if (this.app.vault.getAbstractFileByPath(bundlePath) || await this.app.vault.adapter.stat(bundlePath)) continue;
      const filesPath = normalizePath(`${bundlePath}/Files`);
      return {
        bundlePath,
        taskPath: taskFilePath(bundlePath),
        updatesPath: updatesFilePath(bundlePath),
        filesPath
      };
    }
    throw new Error(`Could not create a unique task folder for ${record.title}.`);
  }

  private relocationCollectionPath(task: IndexedTask): string {
    const bundleParent = parentFolderPath(task.folderPath);
    const destination = parentFolderPath(bundleParent);
    return isTaskRelocationDestination(destination)
      && bundleParent === normalizePath(`${destination}/${taskRelocationCollectionName(destination)}`)
      ? bundleParent
      : task.folderPath;
  }

  private async availableArtifactFolderName(workspace: string, title: string, currentTaskPath = ""): Promise<string> {
    for (let copyNumber = 1; copyNumber <= 999; copyNumber += 1) {
      const folderName = taskArtifactFolderName(title, copyNumber);
      const candidate = taskArtifactNotePath(workspace, folderName);
      if (candidate === currentTaskPath) return folderName;
      const entry = this.app.vault.getAbstractFileByPath(candidate) || await this.app.vault.adapter.stat(candidate);
      if (!entry) return folderName;
    }
    throw new Error(`Could not create a unique task artifact folder for ${title}.`);
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
      if (task.relocatedBundle) {
        return { taskId: task.record.task_id, title: task.record.title, from: task.taskFile.path, to: "", eligible: false, reason: "relocated task bundle" };
      }
      if (task.legacyWorkspace) {
        return { taskId: task.record.task_id, title: task.record.title, from: task.taskFile.path, to: "", eligible: false, reason: "legacy workspace layout" };
      }
      if (usesTaskArtifactLayout(task.taskFile)) {
        return { taskId: task.record.task_id, title: task.record.title, from: task.taskFile.path, to: task.taskFile.path, eligible: false, reason: "already uses task-specific folders" };
      }
      return { taskId: task.record.task_id, title: task.record.title, from: task.taskFile.path, to: taskArtifactNotePath(task.folderPath, taskArtifactFolderName(task.record.title)), eligible: true };
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
      if (task.legacyWorkspace || task.relocatedBundle || usesTaskArtifactLayout(task.taskFile)) continue;
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

  previewTaskArtifactFolderRename(): TaskArtifactFolderRenamePreview[] {
    const reserved = new Set<string>();
    return this.list({ includeArchived: true }).map((task) => {
      if (!usesTaskArtifactLayout(task.taskFile)) {
        return { taskId: task.record.task_id, title: task.record.title, from: task.taskFile.path, to: "", eligible: false, reason: "not in task artifact layout" };
      }
      const current = artifactFolderNameForTask(task);
      let copy = 1;
      let next = taskArtifactFolderName(task.record.title, copy);
      while (reserved.has(`${task.folderPath}/${next}`) || (next !== current && this.app.vault.getAbstractFileByPath(taskArtifactNotePath(task.folderPath, next)))) {
        next = taskArtifactFolderName(task.record.title, ++copy);
      }
      reserved.add(`${task.folderPath}/${next}`);
      return {
        taskId: task.record.task_id,
        title: task.record.title,
        from: task.taskFile.path,
        to: taskArtifactNotePath(task.folderPath, next),
        eligible: current !== next,
        reason: current === next ? "already uses readable task folder" : undefined
      };
    });
  }

  async renameTaskArtifactFolders(): Promise<{ renamed: number; skipped: number; errors: Array<{ taskId: string; message: string }> }> {
    const result = { renamed: 0, skipped: 0, errors: [] as Array<{ taskId: string; message: string }> };
    const preview = this.previewTaskArtifactFolderRename();
    for (const item of preview) {
      if (!item.eligible) { result.skipped += 1; continue; }
      const task = this.index.get(item.taskId);
      if (!task) continue;
      try {
        await this.renameTaskArtifactFolder(task, artifactFolderFromTaskPath(item.to));
        result.renamed += 1;
        await this.refresh();
      } catch (error) {
        result.errors.push({ taskId: item.taskId, message: error instanceof Error ? error.message : String(error) });
        await this.refresh();
      }
    }
    return result;
  }

  private async renameTaskArtifactFolder(task: IndexedTask, targetName: string): Promise<void> {
    const currentName = artifactFolderNameForTask(task);
    const moves = ["Tasks", "Updates", "Files"].map((collection) => ({
      from: taskArtifactFolderPath(task.folderPath, collection, currentName),
      to: taskArtifactFolderPath(task.folderPath, collection, targetName)
    }));
    const completed: Array<{ from: string; to: string }> = [];
    const oldContent = await this.app.vault.read(task.taskFile);
    try {
      for (const move of moves) {
        const folder = this.app.vault.getAbstractFileByPath(move.from);
        if (!(folder instanceof TFolder)) continue;
        if (this.app.vault.getAbstractFileByPath(move.to) || await this.app.vault.adapter.stat(move.to)) {
          throw new Error(`Task artifact destination already exists: ${move.to}`);
        }
        await this.app.vault.rename(folder, move.to);
        completed.push(move);
      }
      const currentTask = this.app.vault.getAbstractFileByPath(taskArtifactNotePath(task.folderPath, targetName));
      if (!(currentTask instanceof TFile)) throw new Error("Renamed task record was not found.");
      const document = parseTaskMarkdown(oldContent);
      const relatedFiles = document.record.related_files.map((path) => path.replace(`/Files/${currentName}/`, `/Files/${targetName}/`));
      await this.app.vault.modify(currentTask, renderTaskMarkdown(updateTaskFields(document.record, { related_files: relatedFiles }), document.body));
    } catch (error) {
      for (const move of completed.reverse()) {
        const folder = this.app.vault.getAbstractFileByPath(move.to);
        if (folder instanceof TFolder) await this.app.vault.rename(folder, move.from);
      }
      const restored = this.app.vault.getAbstractFileByPath(task.taskFile.path);
      if (restored instanceof TFile) await this.app.vault.modify(restored, oldContent);
      throw error;
    }
  }

  private async migrateTaskArtifactLayout(task: IndexedTask, skippedShared: string[]): Promise<number> {
    const paths = await this.availableTaskPaths(task.folderPath, task.record);
    const oldTaskContent = await this.app.vault.read(task.taskFile);
    const updatesFile = task.updatesFile;
    const relatedMoves: Array<{ file: TFile; from: string; to: string }> = [];
    const relatedPaths = new Map<string, string>();
    const filesPath = taskArtifactFilesPath(task.folderPath, taskArtifactFolderName(task.record.title));
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
    if (task.relocatedBundle) return normalizePath(`${task.folderPath}/Files`);
    if (usesTaskArtifactLayout(task.taskFile)) {
      return taskArtifactFilesPath(task.folderPath, artifactFolderNameForTask(task));
    }
    return this.relatedFilesPathForWorkspace(task.folderPath, task.record, false, task.legacyWorkspace);
  }

  private relatedFilesPathForWorkspace(workspace: string, record: TaskRecord, artifactLayout: boolean, legacyWorkspace: boolean): string {
    if (legacyWorkspace) return normalizePath(`${workspace}/attachments`);
    return artifactLayout ? taskArtifactFilesPath(workspace, taskArtifactFolderName(record.title)) : taskFilesFolderPath(workspace);
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

function normalizeTaskTitle(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

function parentFolderPath(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  if (index < 1) throw new Error(`File path has no parent folder: ${path}`);
  return normalized.slice(0, index);
}

function replaceVaultPathPrefix(value: string, previousPrefix: string, nextPrefix: string): string {
  const path = normalizePath(value);
  const previous = normalizePath(previousPrefix);
  if (path === previous) return normalizePath(nextPrefix);
  if (!path.startsWith(`${previous}/`)) return path;
  return normalizePath(`${nextPrefix}/${path.slice(previous.length + 1)}`);
}

function rewriteVaultPath(value: string, rewrites: Array<{ from: string; to: string }>): string {
  let path = normalizePath(value);
  for (const rewrite of rewrites) {
    const next = replaceVaultPathPrefix(path, rewrite.from, rewrite.to);
    if (next !== path) return next;
  }
  return path;
}

function usesTaskArtifactLayout(file: TFile): boolean {
  return usesTaskArtifactPath(file.path);
}

function usesTaskArtifactPath(path: string): boolean {
  return /\/Tasks\/[^/]+\/task\.md$/i.test(normalizePath(path));
}

function artifactFolderNameForTask(task: IndexedTask): string {
  return artifactFolderFromTaskPath(task.taskFile.path);
}

function artifactFolderFromTaskPath(path: string): string {
  const normalized = normalizePath(path);
  const marker = "/Tasks/";
  const start = normalized.lastIndexOf(marker);
  if (start < 0) throw new Error(`Task note is outside a task artifact folder: ${path}`);
  return normalized.slice(start + marker.length, normalized.lastIndexOf("/"));
}
