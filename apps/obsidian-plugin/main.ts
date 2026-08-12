import {
  Notice,
  normalizePath,
  Platform,
  Plugin,
  TAbstractFile,
  TFile,
  WorkspaceLeaf
} from "obsidian";
import { decodeProtocolPayload } from "@fjg/task-protocol";
import { TaskCatalogServer } from "./src/catalog-server";
import { TaskDashboardView, TASK_DASHBOARD_VIEW } from "./src/dashboard-view";
import {
  ArchiveProjectModal,
  CreateProjectModal,
  CreateTaskModal,
  TaskProjectPickerModal,
  TaskFileModal,
  TaskFolderEntry,
  TaskFolderModal,
  TextEntryModal
} from "./src/modals";
import { QuickCaptureModal } from "./src/quick-capture-modal";
import type { TaskCaptureDraft } from "./src/quick-capture-model";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  TaskManagerSettings,
  TaskManagerSettingTab
} from "./src/settings";
import { legacyOpenAiApiKey } from "./src/settings-migration";
import { taskFolderClipboardPath } from "./src/task-folder-path";
import { TaskWorkspaceService } from "./src/workspace-service";
import {
  markGmailTaskIntakeImported,
  parseGmailTaskIntake
} from "./src/gmail-task-intake";

export default class FjgTaskManagerPlugin extends Plugin {
  declare settings: TaskManagerSettings;
  workspaceService!: TaskWorkspaceService;
  private readonly catalogServer = new TaskCatalogServer();
  private refreshTimer: number | null = null;
  private gmailIntakeTimer: number | null = null;
  private gmailIntakeRunning = false;
  private gmailIntakePending = false;

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData() || DEFAULT_SETTINGS);
    const importedLegacyKey = await this.restoreOpenAiApiKey();
    await this.saveData(this.settings);
    this.workspaceService = new TaskWorkspaceService(this.app, () => this.settings);
    await this.workspaceService.initialize();

    this.registerView(TASK_DASHBOARD_VIEW, (leaf) => new TaskDashboardView(leaf, this));
    this.addRibbonIcon("list-checks", "Open FJG Task Manager", () => this.activateDashboard());
    this.addRibbonIcon("circle-plus", "Quick capture a task", () => this.openQuickCaptureModal());
    this.addSettingTab(new TaskManagerSettingTab(this.app, this));
    this.registerObsidianProtocolHandler("fjg-task-clipper", (params) => this.handleClipperPayload(String(params.payload || "")));
    this.registerObsidianProtocolHandler("fjg-task-manager", (params) => {
      this.openQuickCaptureModal(String(params.text || ""));
    });

    this.addCommand({ id: "open-dashboard", name: "Open Task Dashboard", callback: () => this.activateDashboard() });
    this.addCommand({ id: "quick-capture", name: "Quick Capture Task", callback: () => this.openQuickCaptureModal() });
    this.addCommand({ id: "create-project", name: "Create Project", callback: () => this.openCreateProjectModal() });
    this.addCommand({ id: "create-task-workspace", name: "Create Task Workspace", callback: () => this.openCreateModal() });
    this.addCommand({ id: "append-task-update", name: "Append Task Update", checkCallback: (checking) => {
      const task = this.workspaceService.resolveFromFile(this.app.workspace.getActiveFile());
      if (!task) return false;
      if (!checking) this.openUpdateModal(task.record.task_id);
      return true;
    }});
    this.addCommand({ id: "add-task-file", name: "Add File to Task Workspace", checkCallback: (checking) => {
      const task = this.workspaceService.resolveFromFile(this.app.workspace.getActiveFile());
      if (!task) return false;
      if (!checking) this.openTaskFileModal(task.record.task_id);
      return true;
    }});
    this.addCommand({ id: "open-task-folder", name: "Open Task Folder", checkCallback: (checking) => {
      const task = this.workspaceService.resolveFromFile(this.app.workspace.getActiveFile());
      if (!task) return false;
      if (!checking) void this.openTaskFolder(task.record.task_id);
      return true;
    }});
    this.addCommand({ id: "copy-task-folder-path", name: "Copy Task Folder Path", checkCallback: (checking) => {
      const task = this.workspaceService.resolveFromFile(this.app.workspace.getActiveFile());
      if (!task) return false;
      if (!checking) void this.copyTaskFolderPath(task.record.task_id);
      return true;
    }});
    this.addCommand({ id: "mark-task-completed", name: "Mark Task Completed", checkCallback: (checking) => {
      const task = this.workspaceService.resolveFromFile(this.app.workspace.getActiveFile());
      if (!task) return false;
      if (!checking) this.changeStatus(task.record.task_id, "completed");
      return true;
    }});
    this.addCommand({ id: "archive-task", name: "Archive Task", checkCallback: (checking) => {
      const task = this.workspaceService.resolveFromFile(this.app.workspace.getActiveFile());
      if (!task) return false;
      if (!checking) this.changeStatus(task.record.task_id, "archived");
      return true;
    }});
    this.addCommand({ id: "reopen-task-do-first", name: "Reopen Task to Do First", checkCallback: (checking) => {
      const task = this.workspaceService.resolveFromFile(this.app.workspace.getActiveFile());
      if (!task?.archived) return false;
      if (!checking) this.changeStatus(task.record.task_id, "do-first");
      return true;
    }});
    this.addCommand({ id: "copy-task-id", name: "Copy Task ID", checkCallback: (checking) => {
      const task = this.workspaceService.resolveFromFile(this.app.workspace.getActiveFile());
      if (!task) return false;
      if (!checking) navigator.clipboard.writeText(task.record.task_id).then(() => new Notice("Task ID copied."));
      return true;
    }});
    this.addCommand({ id: "validate-task-workspaces", name: "Validate Task Workspaces", callback: () => this.validateWorkspaces() });
    this.addCommand({ id: "preview-task-artifact-migration", name: "Preview Task Artifact Migration", callback: () => this.previewTaskArtifactMigration() });
    this.addCommand({ id: "migrate-task-artifacts", name: "Migrate Task Artifacts to Task Folders", callback: () => this.migrateTaskArtifacts() });
    this.addCommand({ id: "preview-readable-task-folders", name: "Preview Readable Task Folder Rename", callback: () => this.previewReadableTaskFolders() });
    this.addCommand({ id: "rename-readable-task-folders", name: "Rename Task Folders to Readable Titles", callback: () => this.renameReadableTaskFolders() });
    this.addCommand({ id: "rebuild-task-index", name: "Rebuild Task Index", callback: async () => {
      await this.workspaceService.refresh();
      new Notice(`Task index rebuilt: ${this.workspaceService.list({ includeArchived: true }).length} tasks.`);
    }});

    this.registerEvent(this.app.vault.on("create", (file) => {
      this.scheduleRefresh();
      this.scheduleGmailTaskIntake(file);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      this.scheduleRefresh();
      this.scheduleGmailTaskIntake(file);
    }));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));

    this.app.workspace.onLayoutReady(() => {
      if (importedLegacyKey) {
        new Notice("FJG Task Manager reused the OpenAI key already saved by Task Capture.");
      }
      void this.finishStartupAfterLayoutReady();
    });
    await this.restartCatalog();
  }

  async onunload(): Promise<void> {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    if (this.gmailIntakeTimer !== null) window.clearTimeout(this.gmailIntakeTimer);
    await this.catalogServer.stop();
    this.app.workspace.detachLeavesOfType(TASK_DASHBOARD_VIEW);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async resolveOpenAiApiKey(): Promise<string> {
    const currentKey = this.settings.openAiApiKey.trim();
    if (currentKey) return currentKey;

    const savedSettings = normalizeSettings(await this.loadData() || DEFAULT_SETTINGS);
    if (savedSettings.openAiApiKey) {
      this.settings.openAiApiKey = savedSettings.openAiApiKey;
      return savedSettings.openAiApiKey;
    }

    if (await this.restoreOpenAiApiKey()) {
      await this.saveSettings();
      new Notice("FJG Task Manager recovered your saved OpenAI key.");
      return this.settings.openAiApiKey;
    }
    return "";
  }

  async processGmailTaskIntake(): Promise<number> {
    if (!this.settings.gmailTaskIntakeEnabled) return 0;
    if (this.gmailIntakeRunning) {
      this.gmailIntakePending = true;
      return 0;
    }

    this.gmailIntakeRunning = true;
    let imported = 0;
    let attached = 0;
    let failed = 0;
    try {
      const root = normalizePath(this.settings.gmailTaskIntakeRoot);
      const files = this.app.vault.getMarkdownFiles()
        .filter((file) => file.parent?.path === root)
        .sort((left, right) => left.path.localeCompare(right.path));

      for (const file of files) {
        try {
          const markdown = await this.app.vault.read(file);
          const intake = parseGmailTaskIntake(markdown);
          if (!intake) continue;

          let task = this.workspaceService.list({ includeArchived: true })
            .find((candidate) => candidate.record.task_id === intake.taskId);
          if (!task) {
            task = await this.workspaceService.createTask({
              taskId: intake.taskId,
              title: intake.title,
              status: intake.status,
              source: { type: "email", title: intake.emailSubject },
              tags: ["task"],
              createdAt: intake.emailDate,
              updatedAt: intake.emailDate
            }, { requestId: intake.requestId, actor: "Gmail intake" });
            imported++;
          }

          if (intake.importedTaskId && intake.importedTaskId !== task.record.task_id) {
            throw new Error(
              `Gmail intake task ID ${intake.importedTaskId} does not match ${task.record.task_id}.`
            );
          }

          if (intake.attachmentPath) {
            const existingAttachment = this.app.vault.getAbstractFileByPath(normalizePath(intake.attachmentPath));
            if (existingAttachment instanceof TFile) {
              throw new Error(
                `The task attachment already exists while the original email remains in intake: ${intake.attachmentPath}`
              );
            }
          }

          const attachmentPath = await this.workspaceService.availableAttachmentPath(
            task.record.task_id,
            file.name,
            intake.attachmentPath
          );

          const latest = await this.app.vault.read(file);
          const marked = markGmailTaskIntakeImported(latest, {
            taskId: task.record.task_id,
            attachmentPath
          });
          if (marked !== latest) await this.app.vault.modify(file, marked);
          const moved = await this.workspaceService.moveVaultFileToTaskAttachments(
            task.record.task_id,
            file,
            attachmentPath
          );
          attached++;
          try {
            await this.workspaceService.appendUpdate(task.record.task_id, {
              actor: "Gmail intake",
              type: "attachment",
              text: "Original Gmail email moved into the task attachments folder.",
              relatedFiles: [moved.path],
              source: { type: "email", title: intake.emailSubject },
              requestId: `${intake.requestId}_attachment`
            });
          } catch (updateError) {
            console.warn("[FJG Task Manager] Gmail attachment update log failed", moved.path, updateError);
          }
        } catch (error) {
          failed++;
          console.error("[FJG Task Manager] Gmail task intake file failed", file.path, error);
        }
      }

      if (imported > 0 || attached > 0) {
        const taskText = `${imported} Gmail ${imported === 1 ? "task" : "tasks"} added`;
        const attachmentText = `${attached} original ${attached === 1 ? "email" : "emails"} moved to task attachments`;
        new Notice(`${taskText}; ${attachmentText}.`);
        this.refreshDashboard();
      }
      if (failed > 0) {
        new Notice(`${failed} Gmail ${failed === 1 ? "intake needs" : "intakes need"} attention. See Developer Console.`, 10000);
      }
      return imported;
    } catch (error) {
      console.error("[FJG Task Manager] Gmail task intake failed", error);
      new Notice(`Gmail task intake failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
      return imported;
    } finally {
      this.gmailIntakeRunning = false;
      if (this.gmailIntakePending) {
        this.gmailIntakePending = false;
        this.scheduleGmailTaskIntake();
      }
    }
  }

  async restartCatalog(): Promise<void> {
    await this.catalogServer.stop();
    if (!Platform.isDesktopApp || !this.settings.catalogEnabled) return;
    try {
      await this.catalogServer.start({
        port: this.settings.catalogPort,
        token: this.settings.catalogToken,
        getTasks: () => this.workspaceService.catalog(),
        getProjects: () => this.workspaceService.projectNames()
      });
    } catch (error) {
      console.error("[FJG Task Manager] Catalog failed to start", error);
      new Notice(`Task catalog could not start: ${error instanceof Error ? error.message : String(error)}`, 10000);
    }
  }

  async activateDashboard(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(TASK_DASHBOARD_VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: TASK_DASHBOARD_VIEW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  openCreateModal(): void {
    new CreateTaskModal(this.app, this.projectNames(), async (value) => {
      const task = await this.workspaceService.createTask({
        title: value.title,
        details: value.details,
        status: value.status,
        project: value.project,
        due: value.due,
        delegatedTo: value.delegatedTo,
        tags: ["task"]
      });
      new Notice(`Task workspace created: ${task.record.title}`);
      this.refreshDashboard();
    }).open();
  }

  openCreateProjectModal(): void {
    new CreateProjectModal(this.app, async (value) => {
      const project = await this.workspaceService.createProject(value.name, value.description);
      new Notice(`Project created: ${project.record.name}`);
      this.refreshDashboard();
    }).open();
  }

  openTaskProjectPicker(taskId: string): void {
    const task = this.workspaceService.getById(taskId);
    new TaskProjectPickerModal(
      this.app,
      task.record.title,
      task.record.project,
      () => this.projectNames(),
      async (projectName) => this.changeProject(taskId, projectName),
      async (projectName) => {
        const project = await this.workspaceService.createProject(projectName);
        try {
          await this.changeProject(taskId, project.record.name);
        } catch (error) {
          throw new Error(
            `Project created, but the task could not be assigned: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    ).open();
  }

  openArchiveProjectModal(projectName: string, completedTaskCount: number): void {
    new ArchiveProjectModal(this.app, projectName, completedTaskCount, async () => {
      const result = await this.workspaceService.archiveProject(projectName);
      new Notice(
        `Project archived: ${result.project.record.name}. `
        + `${result.archivedTaskCount} completed ${result.archivedTaskCount === 1 ? "task" : "tasks"} archived.`
      );
      this.clearArchivedProjectSelections(result.project.record.name);
      this.refreshDashboard();
    }).open();
  }

  async reopenProject(projectName: string): Promise<void> {
    const project = await this.workspaceService.reopenProject(projectName);
    new Notice(`Project reopened: ${project.record.name}. Archived tasks were left unchanged.`);
    this.refreshDashboard();
  }

  openQuickCaptureModal(initialText = ""): void {
    new QuickCaptureModal(this.app, this, initialText).open();
  }

  projectNames(): string[] {
    return this.workspaceService.projectNames();
  }

  async createCapturedTask(value: TaskCaptureDraft): Promise<void> {
    await this.createCapturedTasks([value]);
  }

  async createCapturedTasks(values: TaskCaptureDraft[]): Promise<void> {
    const tasks = await this.workspaceService.createTasks(values.map((value) => ({
      title: value.title,
      details: value.details,
      status: value.status,
      project: value.project,
      due: value.due,
      delegatedTo: value.delegatedTo,
      tags: ["task"]
    })), { actor: "Franklin" });
    new Notice(
      tasks.length === 1
        ? `Task workspace created: ${tasks[0].record.title}`
        : `${tasks.length} task workspaces created.`
    );
    this.refreshDashboard();
  }

  openUpdateModal(taskId: string): void {
    const task = this.workspaceService.getById(taskId);
    new TextEntryModal(this.app, `Update: ${task.record.title}`, "Add Update", async (text) => {
      await this.workspaceService.appendUpdate(taskId, { actor: "Franklin", text, type: "update" });
      new Notice(`Task updated: ${task.record.title}`);
      this.refreshDashboard();
    }).open();
  }

  async changeStatus(taskId: string, status: string): Promise<void> {
    const task = await this.workspaceService.changeStatus(taskId, status);
    new Notice(`Task moved to ${task.record.status}: ${task.record.title}`);
    this.refreshDashboard();
  }

  async changeProject(taskId: string, projectName: string): Promise<void> {
    const task = await this.workspaceService.changeProject(taskId, projectName);
    new Notice(
      task.record.project
        ? `Task project set to ${task.record.project}: ${task.record.title}`
        : `Task moved to No project: ${task.record.title}`
    );
    this.refreshDashboard();
  }

  async openTask(taskId: string): Promise<void> {
    const task = this.workspaceService.getById(taskId);
    await this.app.workspace.getLeaf("tab").openFile(task.taskFile);
  }

  async openTaskUpdates(taskId: string): Promise<void> {
    const task = this.workspaceService.getById(taskId);
    if (!task.updatesFile) {
      new Notice(`No update log exists for ${task.record.title}.`);
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(task.updatesFile);
  }

  openTaskFileModal(taskId: string): void {
    const task = this.workspaceService.getById(taskId);
    new TaskFileModal(
      this.app,
      task.record.title,
      async (title, body) => {
        const file = await this.workspaceService.createRelatedNote(taskId, title, body);
        await this.app.workspace.getLeaf("tab").openFile(file);
        new Notice(`Note added to ${task.record.title}.`);
        this.refreshDashboard();
      },
      async (files) => {
        const created = await this.workspaceService.importRelatedFiles(taskId, files);
        new Notice(`${created.length} ${created.length === 1 ? "file" : "files"} added to ${task.record.title}.`);
        this.refreshDashboard();
      }
    ).open();
  }

  async openRelatedFile(taskId: string, path: string): Promise<void> {
    const task = this.workspaceService.getById(taskId);
    const file = task.relatedFiles.find((related) => related.file.path === path)?.file;
    if (!file) {
      new Notice("That related file is no longer available.");
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  async openTaskFolder(taskId: string): Promise<void> {
    const task = this.workspaceService.getById(taskId);
    const destination = this.workspaceService.copyFolderForTask(taskId);
    const entries: TaskFolderEntry[] = [
      { file: task.taskFile, description: "Canonical task record", icon: "list-checks" }
    ];
    if (task.updatesFile) {
      entries.push({ file: task.updatesFile, description: "Complete chronological update log", icon: "history" });
    }
    entries.push(...task.relatedFiles.map((related) => ({
      file: related.file,
      description: related.file.path.slice(task.folderPath.length + 1),
      icon: related.kind === "image"
        ? "image"
        : related.kind === "note"
          ? "notebook-pen"
          : related.kind === "pdf"
            ? "file-text"
            : "file"
    })));
    new TaskFolderModal(
      this.app,
      task.record.title,
      destination.folderPath,
      entries,
      async (file) => this.app.workspace.getLeaf("tab").openFile(file)
    ).open();
  }

  async copyTaskFolderPath(taskId: string): Promise<void> {
    const destination = this.workspaceService.copyFolderForTask(taskId);
    const path = taskFolderClipboardPath(destination.folderPath);
    try {
      await navigator.clipboard.writeText(path);
      new Notice(`${destination.legacy ? "Legacy task attachments" : "Task attachments"} folder copied: ${path}`);
    } catch (error) {
      console.error("[FJG Task Manager] Could not copy task folder path", error);
      new Notice("Could not copy the task attachments folder path.");
    }
  }

  private async handleClipperPayload(encoded: string): Promise<void> {
    try {
      if (!encoded) throw new Error("Missing task clipper payload.");
      const payload = decodeProtocolPayload(encoded);
      if (this.settings.processedRequestIds.includes(payload.request_id)) {
        new Notice("This task clipper request was already processed.");
        return;
      }
      if (payload.action === "create-tasks") {
        const created = [];
        for (const item of payload.items) {
          created.push(await this.workspaceService.createFromClip(item, payload.request_id, payload.created_at));
        }
        await this.recordRequest(payload.request_id);
        new Notice(`Created ${created.length} task workspace${created.length === 1 ? "" : "s"}: ${created.map((task) => task.record.title).join(", ")}`);
      } else {
        const task = this.workspaceService.findByIdOrQuery(payload.task_id, payload.task_query);
        await this.workspaceService.appendUpdate(task.record.task_id, {
          actor: "Browser clipper",
          type: "update",
          text: payload.update_text,
          source: payload.source,
          createdAt: payload.created_at,
          requestId: payload.request_id
        });
        await this.recordRequest(payload.request_id);
        new Notice(`Task update added: ${task.record.title}`);
      }
      this.refreshDashboard();
    } catch (error) {
      console.error("[FJG Task Manager] Clipper request failed", error);
      new Notice(`Task clip failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
    }
  }

  private async recordRequest(requestId: string): Promise<void> {
    this.settings.processedRequestIds = [...this.settings.processedRequestIds, requestId].slice(-500);
    await this.saveSettings();
  }

  private async restoreOpenAiApiKey(): Promise<boolean> {
    if (this.settings.openAiApiKey.trim()) return false;
    const legacyDataPath = normalizePath(
      `${this.app.vault.configDir}/plugins/task-capture/data.json`
    );
    try {
      if (!(await this.app.vault.adapter.exists(legacyDataPath))) return false;
      const legacyData = JSON.parse(
        await this.app.vault.adapter.read(legacyDataPath)
      ) as unknown;
      const key = legacyOpenAiApiKey(legacyData);
      if (!key) return false;
      this.settings.openAiApiKey = key;
      return true;
    } catch (error) {
      console.warn(
        "[FJG Task Manager] Could not read legacy Task Capture settings.",
        error
      );
      return false;
    }
  }

  private recoverMissedAdvancedUriLaunch(): void {
    const advancedUri = (this.app as any).plugins?.getPlugin?.("obsidian-advanced-uri");
    if (advancedUri?.lastParameters?.commandid === `${this.manifest.id}:quick-capture`) {
      window.setTimeout(() => this.openQuickCaptureModal(), 250);
    }
  }

  private async finishStartupAfterLayoutReady(): Promise<void> {
    try {
      // Obsidian may call plugin onload before its vault file cache is complete.
      // Refreshing again here ensures existing task workspaces can be renamed
      // without losing them from the dashboard during startup.
      await this.workspaceService.refresh();
      await this.workspaceService.normalizeVisibleFolderNames();
      await this.processGmailTaskIntake();
      this.refreshDashboard();
      this.recoverMissedAdvancedUriLaunch();
    } catch (error) {
      console.error("[FJG Task Manager] Post-layout startup failed", error);
      new Notice(`Task workspaces could not finish loading: ${error instanceof Error ? error.message : String(error)}`, 10000);
    }
  }

  private async validateWorkspaces(): Promise<void> {
    const issues = await this.workspaceService.validateAll();
    if (!issues.length) {
      new Notice(`All ${this.workspaceService.list({ includeArchived: true }).length} task workspaces are valid.`);
      return;
    }
    console.warn("[FJG Task Manager] Validation issues", issues);
    new Notice(`${issues.length} task workspace${issues.length === 1 ? "" : "s"} need attention. See Developer Console.`, 10000);
  }

  private previewTaskArtifactMigration(): void {
    const preview = this.workspaceService.previewTaskArtifactMigration();
    const eligible = preview.filter((item) => item.eligible);
    console.info("[FJG Task Manager] Task artifact migration preview", preview);
    new Notice(`${eligible.length} task ${eligible.length === 1 ? "workspace is" : "workspaces are"} ready for task-folder migration. No files were changed.`, 8000);
  }

  private async migrateTaskArtifacts(): Promise<void> {
    const preview = this.workspaceService.previewTaskArtifactMigration();
    const eligible = preview.filter((item) => item.eligible);
    if (!eligible.length) {
      new Notice("No task workspaces need task-folder migration.");
      return;
    }
    const result = await this.workspaceService.migrateTaskArtifacts();
    console.info("[FJG Task Manager] Task artifact migration result", result);
    this.refreshDashboard();
    new Notice(
      `Migrated ${result.migrated} task ${result.migrated === 1 ? "workspace" : "workspaces"}; `
      + `${result.attachmentMoves} attachment ${result.attachmentMoves === 1 ? "moved" : "moved"}; `
      + `${result.skippedShared.length} shared file ${result.skippedShared.length === 1 ? "skipped" : "skipped"}; `
      + `${result.errors.length} ${result.errors.length === 1 ? "error" : "errors"}.`,
      12000
    );
  }

  private previewReadableTaskFolders(): void {
    const preview = this.workspaceService.previewTaskArtifactFolderRename();
    const eligible = preview.filter((item) => item.eligible);
    console.info("[FJG Task Manager] Readable task folder rename preview", preview);
    new Notice(`${eligible.length} task ${eligible.length === 1 ? "folder is" : "folders are"} ready for readable-title rename. No files were changed.`, 8000);
  }

  private async renameReadableTaskFolders(): Promise<void> {
    const preview = this.workspaceService.previewTaskArtifactFolderRename();
    if (!preview.some((item) => item.eligible)) {
      new Notice("No task folders need readable-title renaming.");
      return;
    }
    const result = await this.workspaceService.renameTaskArtifactFolders();
    console.info("[FJG Task Manager] Readable task folder rename result", result);
    this.refreshDashboard();
    new Notice(`Renamed ${result.renamed} task folders; ${result.skipped} skipped; ${result.errors.length} errors.`, 12000);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(async () => {
      await this.workspaceService.refresh();
      this.refreshDashboard();
    }, 300);
  }

  private scheduleGmailTaskIntake(file?: TAbstractFile): void {
    if (!this.settings.gmailTaskIntakeEnabled) return;
    if (file) {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      const root = normalizePath(this.settings.gmailTaskIntakeRoot);
      if (file.parent?.path !== root) return;
    }
    if (this.gmailIntakeTimer !== null) window.clearTimeout(this.gmailIntakeTimer);
    this.gmailIntakeTimer = window.setTimeout(() => {
      this.gmailIntakeTimer = null;
      void this.processGmailTaskIntake();
    }, 500);
  }

  private refreshDashboard(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(TASK_DASHBOARD_VIEW)) {
      const view = leaf.view;
      if (view instanceof TaskDashboardView) view.render();
    }
  }

  private clearArchivedProjectSelections(projectName: string): void {
    for (const leaf of this.app.workspace.getLeavesOfType(TASK_DASHBOARD_VIEW)) {
      const view = leaf.view;
      if (view instanceof TaskDashboardView) view.clearArchivedProjectSelection(projectName);
    }
  }
}
