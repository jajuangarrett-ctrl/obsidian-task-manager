import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { statusLabel, TASK_STATUSES, TaskStatus } from "@fjg/task-core";
import type FjgTaskManagerPlugin from "../main";
import type { IndexedTask } from "./workspace-service";

export const TASK_DASHBOARD_VIEW = "fjg-task-manager-dashboard";

export class TaskDashboardView extends ItemView {
  private query = "";
  private status: TaskStatus | "all" = "do-first";
  private project = "";

  constructor(leaf: WorkspaceLeaf, private readonly taskPlugin: FjgTaskManagerPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return TASK_DASHBOARD_VIEW;
  }

  getDisplayText(): string {
    return "FJG Task Manager";
  }

  getIcon(): string {
    return "list-checks";
  }

  async onOpen(): Promise<void> {
    this.status = this.taskPlugin.settings.dashboardDefault;
    this.render();
  }

  render(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("fjg-task-dashboard");
    const header = root.createDiv({ cls: "fjg-task-header" });
    const titleWrap = header.createDiv();
    titleWrap.createEl("p", { text: "TASK WORKSPACES", cls: "fjg-eyebrow" });
    titleWrap.createEl("h1", { text: "Task Manager" });
    const actions = header.createDiv({ cls: "fjg-header-actions" });
    const createButton = actions.createEl("button", { text: "Create Task", cls: "mod-cta" });
    createButton.addEventListener("click", () => this.taskPlugin.openCreateModal());
    const refreshButton = actions.createEl("button", { text: "Refresh" });
    refreshButton.addEventListener("click", async () => {
      await this.taskPlugin.workspaceService.refresh();
      this.render();
    });

    const filters = root.createDiv({ cls: "fjg-task-filters" });
    const search = filters.createEl("input", { type: "search", placeholder: "Search tasks" });
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderRows(root);
    });
    const statusSelect = filters.createEl("select");
    statusSelect.createEl("option", { text: "All open", value: "all" });
    for (const status of TASK_STATUSES.filter((item) => item !== "archived")) {
      statusSelect.createEl("option", { text: statusLabel(status), value: status });
    }
    statusSelect.value = this.status;
    statusSelect.addEventListener("change", () => {
      this.status = statusSelect.value as TaskStatus | "all";
      this.renderRows(root);
    });
    const projectSelect = filters.createEl("select");
    projectSelect.createEl("option", { text: "All projects", value: "" });
    const projects = [...new Set(this.taskPlugin.workspaceService.list().map((task) => task.record.project).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    for (const project of projects) projectSelect.createEl("option", { text: project, value: project });
    projectSelect.value = this.project;
    projectSelect.addEventListener("change", () => {
      this.project = projectSelect.value;
      this.renderRows(root);
    });

    const summary = root.createDiv({ cls: "fjg-task-summary" });
    const tasks = this.taskPlugin.workspaceService.list();
    this.metric(summary, "Do First", tasks.filter((task) => task.record.status === "do-first").length);
    this.metric(summary, "Due or overdue", tasks.filter(isDueOrOverdue).length);
    this.metric(summary, "Waiting", tasks.filter((task) => task.record.status === "waiting").length);
    this.metric(summary, "Delegated", tasks.filter((task) => task.record.status === "delegate").length);

    root.createDiv({ cls: "fjg-task-rows", attr: { "data-fjg-task-rows": "true" } });
    this.renderRows(root);
  }

  private renderRows(root: HTMLElement): void {
    const rows = root.querySelector<HTMLElement>("[data-fjg-task-rows]");
    if (!rows) return;
    rows.empty();
    const query = normalize(this.query);
    const tasks = this.taskPlugin.workspaceService.list().filter((task) => {
      if (this.status === "all" && (task.record.status === "completed" || task.record.status === "archived")) return false;
      if (this.status !== "all" && task.record.status !== this.status) return false;
      if (this.project && task.record.project !== this.project) return false;
      if (!query) return true;
      return normalize([
        task.record.title,
        task.record.task_id,
        task.record.project,
        task.record.delegated_to,
        task.record.status
      ].join(" ")).includes(query);
    });
    if (!tasks.length) {
      rows.createDiv({ cls: "fjg-empty", text: "No tasks match this view." });
      return;
    }
    for (const task of tasks) this.renderTask(rows, task);
  }

  private renderTask(parent: HTMLElement, task: IndexedTask): void {
    const row = parent.createDiv({ cls: "fjg-task-row" });
    const main = row.createDiv({ cls: "fjg-task-main" });
    const title = main.createEl("button", { text: task.record.title, cls: "fjg-task-title" });
    title.addEventListener("click", () => this.taskPlugin.openTask(task.record.task_id));
    const meta = main.createDiv({ cls: "fjg-task-meta" });
    meta.createSpan({ text: task.record.task_id });
    if (task.record.project) meta.createSpan({ text: task.record.project });
    if (task.record.due) meta.createSpan({ text: `Due ${task.record.due}`, cls: isDueOrOverdue(task) ? "is-overdue" : "" });
    if (task.record.delegated_to) meta.createSpan({ text: `Delegated to ${task.record.delegated_to}` });
    const controls = row.createDiv({ cls: "fjg-task-controls" });
    const status = controls.createEl("select");
    for (const value of TASK_STATUSES.filter((item) => item !== "archived")) {
      status.createEl("option", { text: statusLabel(value), value });
    }
    status.value = task.record.status;
    status.addEventListener("change", async () => {
      try {
        await this.taskPlugin.changeStatus(task.record.task_id, status.value);
        this.render();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    });
    const update = controls.createEl("button", { text: "Update" });
    update.addEventListener("click", () => this.taskPlugin.openUpdateModal(task.record.task_id));
    const archive = controls.createEl("button", { text: "Archive" });
    archive.addEventListener("click", async () => {
      await this.taskPlugin.changeStatus(task.record.task_id, "archived");
      this.render();
    });
  }

  private metric(parent: HTMLElement, label: string, value: number): void {
    const card = parent.createDiv({ cls: "fjg-metric" });
    card.createEl("strong", { text: String(value) });
    card.createSpan({ text: label });
  }
}

function isDueOrOverdue(task: IndexedTask): boolean {
  if (!task.record.due || task.record.status === "completed" || task.record.status === "archived") return false;
  return task.record.due <= new Date().toISOString().slice(0, 10);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}
