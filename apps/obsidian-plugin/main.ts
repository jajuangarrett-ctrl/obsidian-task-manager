import {
  Notice,
  Platform,
  Plugin,
  WorkspaceLeaf
} from "obsidian";
import { decodeProtocolPayload } from "@fjg/task-protocol";
import { TaskCatalogServer } from "./src/catalog-server";
import { TaskDashboardView, TASK_DASHBOARD_VIEW } from "./src/dashboard-view";
import {
  CreateTaskModal,
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
import { TaskWorkspaceService } from "./src/workspace-service";

export default class FjgTaskManagerPlugin extends Plugin {
  declare settings: TaskManagerSettings;
  workspaceService!: TaskWorkspaceService;
  private readonly catalogServer = new TaskCatalogServer();
  private refreshTimer: number | null = null;

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData() || DEFAULT_SETTINGS);
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
    this.addCommand({ id: "rebuild-task-index", name: "Rebuild Task Index", callback: async () => {
      await this.workspaceService.refresh();
      new Notice(`Task index rebuilt: ${this.workspaceService.list({ includeArchived: true }).length} tasks.`);
    }});

    this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("modify", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));

    this.app.workspace.onLayoutReady(() => {
      void this.finishStartupAfterLayoutReady();
    });
    await this.restartCatalog();
  }

  async onunload(): Promise<void> {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    await this.catalogServer.stop();
    this.app.workspace.detachLeavesOfType(TASK_DASHBOARD_VIEW);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async restartCatalog(): Promise<void> {
    await this.catalogServer.stop();
    if (!Platform.isDesktopApp || !this.settings.catalogEnabled) return;
    try {
      await this.catalogServer.start({
        port: this.settings.catalogPort,
        token: this.settings.catalogToken,
        getTasks: () => this.workspaceService.catalog()
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
    new CreateTaskModal(this.app, async (value) => {
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

  openQuickCaptureModal(initialText = ""): void {
    new QuickCaptureModal(this.app, this, initialText).open();
  }

  projectNames(): string[] {
    return [...new Set(
      this.workspaceService
        .list({ includeArchived: true })
        .map((task) => task.record.project.trim())
        .filter(Boolean)
    )].sort((left, right) => left.localeCompare(right));
  }

  async createCapturedTask(value: TaskCaptureDraft): Promise<void> {
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
      task.folderPath,
      entries,
      async (file) => this.app.workspace.getLeaf("tab").openFile(file)
    ).open();
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

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(async () => {
      await this.workspaceService.refresh();
      this.refreshDashboard();
    }, 300);
  }

  private refreshDashboard(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(TASK_DASHBOARD_VIEW)) {
      const view = leaf.view;
      if (view instanceof TaskDashboardView) view.render();
    }
  }
}
