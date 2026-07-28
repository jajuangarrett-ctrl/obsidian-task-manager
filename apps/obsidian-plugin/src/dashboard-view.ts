import { ItemView, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import { statusLabel, TASK_STATUSES } from "@fjg/task-core";
import type FjgTaskManagerPlugin from "../main";
import {
  ALL_PROJECTS,
  countTasksForView,
  DashboardMode,
  isDueOrOverdue,
  matchesProject,
  NO_PROJECT,
  ProjectSummary,
  summarizeProjects,
  TASK_VIEWS,
  taskMatchesView,
  TaskViewKey
} from "./dashboard-model";
import type { IndexedTask } from "./workspace-service";

export const TASK_DASHBOARD_VIEW = "fjg-task-manager-dashboard";

export class TaskDashboardView extends ItemView {
  private mode: DashboardMode = "tasks";
  private query = "";
  private projectQuery = "";
  private view: TaskViewKey = "do-first";
  private project = ALL_PROJECTS;

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
    this.view = this.taskPlugin.settings.dashboardDefault;
    this.render();
  }

  render(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("fjg-task-dashboard");
    this.renderHeader(root);

    const tasks = this.taskPlugin.workspaceService.list();
    const projects = summarizeProjects(tasks.map((task) => task.record));
    this.renderSectionTabs(root, projects.length);
    if (this.mode === "projects") {
      this.renderProjects(root, projects);
    } else {
      this.renderTasks(root, tasks, projects);
    }
  }

  private renderHeader(root: HTMLElement): void {
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
  }

  private renderSectionTabs(root: HTMLElement, projectCount: number): void {
    const tabs = root.createDiv({
      cls: "fjg-dashboard-tabs",
      attr: { role: "tablist", "aria-label": "Task Manager sections" }
    });
    this.sectionTab(tabs, "tasks", "Tasks", "list-checks");
    this.sectionTab(tabs, "projects", "Projects", "folder-kanban", projectCount);
  }

  private sectionTab(
    parent: HTMLElement,
    mode: DashboardMode,
    label: string,
    icon: string,
    count?: number
  ): void {
    const button = parent.createEl("button", {
      cls: `fjg-dashboard-tab${this.mode === mode ? " is-active" : ""}`,
      attr: {
        role: "tab",
        "aria-selected": String(this.mode === mode)
      }
    });
    const iconEl = button.createSpan({ cls: "fjg-tab-icon" });
    setIcon(iconEl, icon);
    button.createSpan({ text: label });
    if (count !== undefined) button.createSpan({ text: String(count), cls: "fjg-tab-count" });
    button.addEventListener("click", () => {
      this.mode = mode;
      this.render();
    });
  }

  private renderTasks(root: HTMLElement, tasks: IndexedTask[], projects: ProjectSummary[]): void {
    const activeProject = projects.find((project) => project.key === this.project);
    if (activeProject) this.renderActiveProject(root, activeProject);

    const heading = root.createDiv({ cls: "fjg-section-heading" });
    const headingCopy = heading.createDiv();
    headingCopy.createEl("h2", { text: activeProject ? activeProject.name : "Task Views" });
    headingCopy.createEl("p", {
      text: activeProject
        ? `${activeProject.openCount} open · ${activeProject.totalCount} total`
        : "Choose a focus and keep the rest of the dashboard quiet."
    });

    const viewNav = root.createDiv({
      cls: "fjg-view-grid",
      attr: { "aria-label": "Task views" }
    });
    const records = tasks.map((task) => task.record);
    for (const definition of TASK_VIEWS) {
      const button = viewNav.createEl("button", {
        cls: `fjg-view-card${this.view === definition.key ? " is-active" : ""}`,
        attr: {
          "aria-pressed": String(this.view === definition.key),
          "data-view": definition.key
        }
      });
      const iconEl = button.createSpan({ cls: "fjg-view-icon" });
      setIcon(iconEl, definition.icon);
      const copy = button.createSpan({ cls: "fjg-view-copy" });
      copy.createSpan({ text: definition.label, cls: "fjg-view-label" });
      copy.createSpan({
        text: `${countTasksForView(records, definition.key)} tasks`,
        cls: "fjg-view-count"
      });
      button.addEventListener("click", () => {
        this.view = definition.key;
        this.render();
      });
    }

    const filters = root.createDiv({ cls: "fjg-task-filters" });
    const search = filters.createEl("input", {
      type: "search",
      placeholder: "Search the current view",
      attr: { "aria-label": "Search tasks in the current view" }
    });
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderRows(root);
    });

    const projectSelect = filters.createEl("select", {
      attr: { "aria-label": "Filter tasks by project" }
    });
    projectSelect.createEl("option", { text: "All projects", value: ALL_PROJECTS });
    for (const project of projects) {
      projectSelect.createEl("option", { text: project.name, value: project.key });
    }
    projectSelect.value = this.project;
    projectSelect.addEventListener("change", () => {
      this.project = projectSelect.value;
      this.render();
    });

    root.createDiv({
      cls: "fjg-task-rows",
      attr: {
        "data-fjg-task-rows": "true",
        "aria-live": "polite"
      }
    });
    this.renderRows(root);
  }

  private renderActiveProject(root: HTMLElement, project: ProjectSummary): void {
    const banner = root.createDiv({ cls: "fjg-active-project" });
    const back = banner.createEl("button", {
      cls: "fjg-back-button",
      attr: { "aria-label": "Back to all projects" }
    });
    const iconEl = back.createSpan();
    setIcon(iconEl, "arrow-left");
    back.createSpan({ text: "All projects" });
    back.addEventListener("click", () => {
      this.mode = "projects";
      this.render();
    });
    const counts = banner.createSpan({
      text: `${project.openCount} open · ${project.totalCount} total`,
      cls: "fjg-active-project-count"
    });
    counts.setAttr("aria-label", `${project.openCount} open tasks, ${project.totalCount} total tasks`);
  }

  private renderProjects(root: HTMLElement, projects: ProjectSummary[]): void {
    const heading = root.createDiv({ cls: "fjg-section-heading fjg-project-heading" });
    const copy = heading.createDiv();
    copy.createEl("h2", { text: "Projects" });
    copy.createEl("p", { text: "See every project at a glance, then open only the work you need." });
    const totalOpen = projects.reduce((total, project) => total + project.openCount, 0);
    heading.createSpan({
      text: `${projects.length} projects · ${totalOpen} open tasks`,
      cls: "fjg-project-rollup"
    });

    const tools = root.createDiv({ cls: "fjg-project-tools" });
    const search = tools.createEl("input", {
      type: "search",
      placeholder: "Search projects",
      attr: { "aria-label": "Search projects" }
    });
    search.value = this.projectQuery;
    const cards = root.createDiv({
      cls: "fjg-project-grid",
      attr: { "data-fjg-project-grid": "true", "aria-live": "polite" }
    });
    search.addEventListener("input", () => {
      this.projectQuery = search.value;
      this.renderProjectCards(cards, projects);
    });
    this.renderProjectCards(cards, projects);
  }

  private renderProjectCards(parent: HTMLElement, projects: ProjectSummary[]): void {
    parent.empty();
    const query = normalize(this.projectQuery);
    const visible = projects.filter((project) => !query || normalize(project.name).includes(query));
    if (!visible.length) {
      parent.createDiv({
        cls: "fjg-empty",
        text: projects.length ? "No projects match this search." : "Projects will appear here when tasks have a project."
      });
      return;
    }
    for (const project of visible) {
      const button = parent.createEl("button", {
        cls: "fjg-project-card",
        attr: {
          "aria-label": `${project.name}, ${project.openCount} open tasks, ${project.totalCount} total tasks`
        }
      });
      const iconEl = button.createSpan({ cls: "fjg-project-icon" });
      setIcon(iconEl, project.key === NO_PROJECT ? "inbox" : "folder");
      const copy = button.createSpan({ cls: "fjg-project-copy" });
      copy.createSpan({ text: project.name, cls: "fjg-project-name" });
      copy.createSpan({
        text: `${project.openCount} open`,
        cls: "fjg-project-open"
      });
      const total = button.createSpan({ cls: "fjg-project-total" });
      total.createSpan({ text: String(project.totalCount) });
      const chevron = total.createSpan({ cls: "fjg-project-chevron" });
      setIcon(chevron, "chevron-right");
      button.addEventListener("click", () => {
        this.mode = "tasks";
        this.project = project.key;
        this.view = "all-open";
        this.query = "";
        this.render();
      });
    }
  }

  private renderRows(root: HTMLElement): void {
    const rows = root.querySelector<HTMLElement>("[data-fjg-task-rows]");
    if (!rows) return;
    rows.empty();
    const query = normalize(this.query);
    const tasks = this.taskPlugin.workspaceService.list().filter((task) => {
      if (!taskMatchesSearch(task, query)) return false;
      if (!matchesProject(task.record, this.project)) return false;
      return taskMatchesView(task.record, this.view);
    });
    if (!tasks.length) {
      rows.createDiv({ cls: "fjg-empty", text: "No tasks match this view." });
      return;
    }
    for (const task of tasks) this.renderTask(rows, task);
  }

  private renderTask(parent: HTMLElement, task: IndexedTask): void {
    const row = parent.createDiv({
      cls: "fjg-task-row",
      attr: { "data-status": task.record.status }
    });
    const main = row.createDiv({ cls: "fjg-task-main" });
    const title = main.createEl("button", { text: task.record.title, cls: "fjg-task-title" });
    title.addEventListener("click", () => this.taskPlugin.openTask(task.record.task_id));
    const meta = main.createDiv({ cls: "fjg-task-meta" });
    meta.createSpan({
      text: statusLabel(task.record.status),
      cls: `fjg-status-badge is-${task.record.status}`
    });
    if (task.record.project) meta.createSpan({ text: task.record.project });
    if (task.record.due) {
      meta.createSpan({
        text: `Due ${task.record.due}`,
        cls: isDueOrOverdue(task.record) ? "is-overdue" : ""
      });
    }
    if (task.record.delegated_to) meta.createSpan({ text: `Delegated to ${task.record.delegated_to}` });
    meta.createSpan({ text: `ID ${task.record.task_id}`, cls: "fjg-task-id" });

    const controls = row.createDiv({ cls: "fjg-task-controls" });
    const status = controls.createEl("select", {
      attr: { "aria-label": `Status for ${task.record.title}` }
    });
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
    const update = controls.createEl("button", {
      text: "Update",
      attr: { "aria-label": `Add an update to ${task.record.title}` }
    });
    update.addEventListener("click", () => this.taskPlugin.openUpdateModal(task.record.task_id));
    const archive = controls.createEl("button", {
      text: "Archive",
      attr: { "aria-label": `Archive ${task.record.title}` }
    });
    archive.addEventListener("click", async () => {
      try {
        await this.taskPlugin.changeStatus(task.record.task_id, "archived");
        this.render();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    });
  }
}

function taskMatchesSearch(task: IndexedTask, query: string): boolean {
  if (!query) return true;
  return normalize([
    task.record.title,
    task.record.task_id,
    task.record.project,
    task.record.delegated_to,
    task.record.status
  ].join(" ")).includes(query);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}
