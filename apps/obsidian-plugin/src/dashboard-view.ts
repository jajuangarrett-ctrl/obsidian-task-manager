import { ItemView, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import { statusLabel, TASK_STATUSES } from "@fjg/task-core";
import type { TaskStatus } from "@fjg/task-core";
import type FjgTaskManagerPlugin from "../main";
import { DashboardProjectPickerModal } from "./modals";
import {
  ALL_PROJECTS,
  canArchiveProject,
  DashboardMode,
  groupTasksForKanban,
  isDueOrOverdue,
  kanbanMoveTarget,
  matchesProject,
  mostRecentlyModifiedTasks,
  NO_PROJECT,
  projectSelectionAfterArchive,
  ProjectSummary,
  summarizeProjects,
  TASK_VIEWS,
  taskMatchesView,
  TaskViewKey
} from "./dashboard-model";
import type { IndexedProject, IndexedTask } from "./workspace-service";
import { formatFileSize, RelatedFileKind } from "./related-files";

export const TASK_DASHBOARD_VIEW = "fjg-task-manager-dashboard";

export class TaskDashboardView extends ItemView {
  private mode: DashboardMode = "tasks";
  private query = "";
  private projectQuery = "";
  private view: TaskViewKey = "do-first";
  private project = ALL_PROJECTS;
  private projectScope: "active" | "archived" = "active";
  private readonly expandedFileTasks = new Set<string>();

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

  /** Called by the plugin after a project has been successfully archived. */
  clearArchivedProjectSelection(projectName: string): boolean {
    const nextProject = projectSelectionAfterArchive(this.project, projectName);
    if (nextProject === this.project) return false;
    this.project = nextProject;
    return true;
  }

  render(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("fjg-task-dashboard");
    this.renderHeader(root);

    const tasks = this.taskPlugin.workspaceService.list();
    const allTasks = this.taskPlugin.workspaceService.list({ includeArchived: true });
    const projects = summarizeProjects(
      tasks.map((task) => task.record),
      this.taskPlugin.workspaceService.projectNames()
    );
    this.renderSectionTabs(root, projects.filter((project) => project.key !== NO_PROJECT).length, allTasks.length);
    if (this.mode === "projects") {
      this.renderProjects(root, projects, allTasks);
    } else if (this.mode === "kanban") {
      this.renderKanban(root, allTasks.filter((task) => task.record.status !== "archived"));
    } else {
      this.renderTasks(root, allTasks, projects);
    }
  }

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: "fjg-task-header" });
    const titleWrap = header.createDiv();
    titleWrap.createEl("p", { text: "TASK WORKSPACES", cls: "fjg-eyebrow" });
    titleWrap.createEl("h1", { text: "Task Manager" });
    const actions = header.createDiv({ cls: "fjg-header-actions" });
    const createButton = actions.createEl("button", { text: "Capture Task", cls: "mod-cta" });
    createButton.addEventListener("click", () => this.taskPlugin.openQuickCaptureModal());
    const briefingButton = actions.createEl("button", {
      text: "Open Task Briefing",
      attr: {
        title: "Refresh and open the Task Manager briefing for Claudian",
        "aria-label": "Refresh and open Task Manager briefing"
      }
    });
    briefingButton.addEventListener("click", () => void this.taskPlugin.openTaskBriefing());
    const refreshButton = actions.createEl("button", { text: "Refresh" });
    refreshButton.setAttribute("title", "Refresh tasks and regenerate the Task Manager briefing");
    refreshButton.setAttribute("aria-label", "Refresh tasks and regenerate Task Manager briefing");
    refreshButton.addEventListener("click", async () => {
      await this.taskPlugin.workspaceService.refresh();
      this.render();
    });
  }

  private renderSectionTabs(root: HTMLElement, projectCount: number, taskCount: number): void {
    const tabs = root.createDiv({
      cls: "fjg-dashboard-tabs",
      attr: { role: "tablist", "aria-label": "Task Manager sections" }
    });
    this.sectionTab(tabs, "tasks", "Tasks", "list-checks");
    this.sectionTab(tabs, "kanban", "Kanban", "columns-3", taskCount);
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
    const selectedRecords = tasks
      .filter((task) => matchesProject(task.record, this.project))
      .filter((task) => this.view === "archived" || task.record.status !== "archived");
    const selectedName = this.project === NO_PROJECT ? "No project" : this.project;
    if (this.project !== ALL_PROJECTS) this.renderActiveProject(root);

    const heading = root.createDiv({ cls: "fjg-section-heading" });
    const headingCopy = heading.createDiv();
    headingCopy.createEl("h2", {
      text: this.project === ALL_PROJECTS ? "Task Views" : (activeProject?.name || selectedName)
    });
    headingCopy.createEl("p", {
      text: this.project !== ALL_PROJECTS
        ? `${selectedRecords.filter((task) => task.record.status !== "completed" && task.record.status !== "archived").length} open · ${selectedRecords.length} total`
        : "Choose a focus and keep the rest of the dashboard quiet."
    });

    const viewNav = root.createDiv({
      cls: "fjg-view-grid",
      attr: { "aria-label": "Task views" }
    });
    const scopedTasks = tasks.filter((task) => matchesProject(task.record, this.project));
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
      const viewTasks = definition.key === "recent"
        ? mostRecentlyModifiedTasks(scopedTasks
          .filter((task) => taskMatchesView(task.record, definition.key, undefined, task.statusAssigned))
          .map((task) => ({
          ...task,
          modifiedAt: task.taskFile.stat.mtime
        })))
        : scopedTasks.filter((task) => taskMatchesView(task.record, definition.key, undefined, task.statusAssigned));
      copy.createSpan({
        text: taskCountLabel(viewTasks.length),
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

    const projectOptions = [...projects];
    if (this.view === "archived") {
      const known = new Set(projectOptions.map((project) => normalize(project.key)));
      const archivedProjects = tasks.filter((task) => task.archived && task.record.project.trim());
      for (const task of archivedProjects) {
        const name = task.record.project.trim();
        if (known.has(normalize(name))) continue;
        const totalCount = archivedProjects.filter((candidate) => normalize(candidate.record.project) === normalize(name)).length;
        projectOptions.push({ key: name, name, openCount: 0, totalCount });
        known.add(normalize(name));
      }
      const archivedWithoutProject = tasks.filter((task) => task.archived && !task.record.project.trim()).length;
      if (archivedWithoutProject && !projectOptions.some((project) => project.key === NO_PROJECT)) {
        projectOptions.push({
          key: NO_PROJECT,
          name: "No project",
          openCount: 0,
          totalCount: archivedWithoutProject
        });
      }
      projectOptions.sort((left, right) => {
        if (left.key === NO_PROJECT) return 1;
        if (right.key === NO_PROJECT) return -1;
        return left.name.localeCompare(right.name);
      });
    }
    const projectPicker = filters.createEl("button", {
      cls: "fjg-dashboard-project-filter",
      text: this.project === ALL_PROJECTS ? "All projects" : (projectOptions.find((option) => option.key === this.project)?.name || selectedName),
      attr: { type: "button", "aria-label": "Filter tasks by project" }
    });
    projectPicker.addEventListener("click", () => {
      new DashboardProjectPickerModal(
        this.app,
        this.project,
        [
          { key: ALL_PROJECTS, name: "All projects" },
          ...projectOptions.map((project) => ({ key: project.key, name: project.name }))
        ],
        (projectKey) => {
          this.project = projectKey;
          this.render();
        }
      ).open();
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

  private renderKanban(root: HTMLElement, tasks: IndexedTask[]): void {
    const heading = root.createDiv({ cls: "fjg-section-heading fjg-kanban-heading" });
    const headingCopy = heading.createDiv();
    headingCopy.createEl("h2", { text: "Kanban" });
    headingCopy.createEl("p", {
      text: "Scan every task by status. Drag cards between columns or use the status menu on a card."
    });
    heading.createSpan({
      text: taskCountLabel(tasks.length),
      cls: "fjg-kanban-total"
    });

    const board = root.createDiv({
      cls: "fjg-kanban-board",
      attr: { "aria-label": "Tasks grouped by status" }
    });
    for (const column of groupTasksForKanban(tasks)) {
      const section = board.createEl("section", {
        cls: `fjg-kanban-column is-${column.status}`,
        attr: {
          "aria-labelledby": `fjg-kanban-${column.status}`,
          "data-kanban-status": column.status
        }
      });
      const columnHeading = section.createDiv({ cls: "fjg-kanban-column-heading" });
      columnHeading.createEl("h3", {
        text: statusLabel(column.status),
        attr: { id: `fjg-kanban-${column.status}` }
      });
      columnHeading.createSpan({
        text: String(column.tasks.length),
        cls: "fjg-kanban-count",
        attr: { "aria-label": taskCountLabel(column.tasks.length) }
      });
      const cards = section.createDiv({ cls: "fjg-kanban-cards" });
      section.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        section.addClass("is-drag-over");
      });
      section.addEventListener("dragleave", (event) => {
        if (!event.relatedTarget || !section.contains(event.relatedTarget as Node)) {
          section.removeClass("is-drag-over");
        }
      });
      section.addEventListener("drop", (event) => {
        event.preventDefault();
        section.removeClass("is-drag-over");
        const taskId = event.dataTransfer?.getData("application/x-fjg-task-id")
          || event.dataTransfer?.getData("text/plain")
          || "";
        void this.moveKanbanTask(taskId, column.status);
      });
      if (!column.tasks.length) {
        cards.createDiv({ text: "Drop tasks here", cls: "fjg-kanban-empty" });
        continue;
      }
      for (const task of column.tasks) this.renderKanbanCard(cards, task);
    }
  }

  private renderKanbanCard(parent: HTMLElement, task: IndexedTask): void {
    const card = parent.createEl("article", {
      cls: "fjg-kanban-card",
      attr: {
        draggable: "true",
        "data-task-id": task.record.task_id,
        "data-status": task.record.status
      }
    });
    card.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-fjg-task-id", task.record.task_id);
      event.dataTransfer.setData("text/plain", task.record.task_id);
      card.addClass("is-dragging");
    });
    card.addEventListener("dragend", () => {
      card.removeClass("is-dragging");
      this.containerEl.querySelectorAll(".fjg-kanban-column.is-drag-over")
        .forEach((column) => column.removeClass("is-drag-over"));
    });

    const title = card.createEl("button", {
      text: task.record.title,
      cls: "fjg-kanban-card-title",
      attr: { type: "button" }
    });
    title.addEventListener("click", () => void this.taskPlugin.openTask(task.record.task_id));
    const meta = card.createDiv({ cls: "fjg-kanban-card-meta" });
    if (task.record.project) meta.createSpan({ text: task.record.project, cls: "is-project" });
    if (task.record.due) {
      meta.createSpan({
        text: `Due ${task.record.due}`,
        cls: isDueOrOverdue(task.record) ? "is-overdue" : ""
      });
    }
    if (task.record.delegated_to) meta.createSpan({ text: task.record.delegated_to, cls: "is-delegated" });
    const latestUpdate = task.updates.find((update) => update.type !== "created");
    if (latestUpdate) card.createEl("p", { text: latestUpdate.text, cls: "fjg-kanban-card-update" });

    const fallback = card.createEl("label", { cls: "fjg-kanban-status-control" });
    fallback.createSpan({ text: "Status" });
    const status = fallback.createEl("select", {
      attr: { "aria-label": `Change status for ${task.record.title}` }
    });
    for (const value of TASK_STATUSES) {
      status.createEl("option", { text: statusLabel(value), value });
    }
    status.value = task.record.status;
    status.addEventListener("change", () => void this.moveKanbanTask(task.record.task_id, status.value));
  }

  private async moveKanbanTask(taskId: string, target: unknown): Promise<void> {
    const task = this.taskPlugin.workspaceService
      .list({ includeArchived: true })
      .find((candidate) => candidate.record.task_id === taskId);
    if (!task) return;
    const status = kanbanMoveTarget(task.record.status, target);
    if (!status) return;
    try {
      await this.taskPlugin.changeStatus(taskId, status);
      this.render();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
      this.render();
    }
  }

  private renderActiveProject(root: HTMLElement): void {
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
      this.projectScope = this.view === "archived" ? "archived" : "active";
      this.render();
    });
  }

  private renderProjects(root: HTMLElement, projects: ProjectSummary[], tasks: IndexedTask[]): void {
    const archivedProjects = this.taskPlugin.workspaceService
      .listProjects({ includeArchived: true })
      .filter((project) => project.archived);
    const showingArchived = this.projectScope === "archived";
    const heading = root.createDiv({ cls: "fjg-section-heading fjg-project-heading" });
    const copy = heading.createDiv();
    copy.createEl("h2", { text: showingArchived ? "Archived Projects" : "Projects" });
    copy.createEl("p", {
      text: showingArchived
        ? "Review completed project work or return a project to your active list."
        : "See every project at a glance, then open only the work you need."
    });
    const namedProjectCount = projects.filter((project) => project.key !== NO_PROJECT).length;
    const totalOpen = projects.reduce((total, project) => total + project.openCount, 0);
    heading.createSpan({
      text: showingArchived
        ? countLabel(archivedProjects.length, "archived project")
        : `${countLabel(namedProjectCount, "project")} · ${totalOpen} open ${totalOpen === 1 ? "task" : "tasks"}`,
      cls: "fjg-project-rollup"
    });

    const scope = root.createDiv({
      cls: "fjg-project-scope",
      attr: { role: "tablist", "aria-label": "Project lists" }
    });
    this.projectScopeButton(scope, "active", "Active Projects", projects.filter((project) => project.key !== NO_PROJECT).length);
    this.projectScopeButton(scope, "archived", "Archived Projects", archivedProjects.length);

    const tools = root.createDiv({ cls: "fjg-project-tools" });
    const search = tools.createEl("input", {
      type: "search",
      placeholder: showingArchived ? "Search archived projects" : "Search projects",
      attr: { "aria-label": showingArchived ? "Search archived projects" : "Search projects" }
    });
    search.value = this.projectQuery;
    if (!showingArchived) {
      const createProject = tools.createEl("button", {
        cls: "mod-cta fjg-create-project-button",
        attr: { type: "button", "aria-label": "Create a new project" }
      });
      const createIcon = createProject.createSpan();
      setIcon(createIcon, "plus");
      createProject.createSpan({ text: "New Project" });
      createProject.addEventListener("click", () => this.taskPlugin.openCreateProjectModal());
    }
    const cards = root.createDiv({
      cls: "fjg-project-grid",
      attr: { "data-fjg-project-grid": "true", "aria-live": "polite" }
    });
    search.addEventListener("input", () => {
      this.projectQuery = search.value;
      if (showingArchived) this.renderArchivedProjectCards(cards, archivedProjects, tasks);
      else this.renderProjectCards(cards, projects);
    });
    if (showingArchived) this.renderArchivedProjectCards(cards, archivedProjects, tasks);
    else this.renderProjectCards(cards, projects);
  }

  private projectScopeButton(
    parent: HTMLElement,
    scope: "active" | "archived",
    label: string,
    count: number
  ): void {
    const button = parent.createEl("button", {
      cls: this.projectScope === scope ? "is-active" : "",
      attr: {
        type: "button",
        role: "tab",
        "aria-selected": String(this.projectScope === scope)
      }
    });
    button.createSpan({ text: label });
    button.createSpan({ text: String(count), cls: "fjg-project-scope-count" });
    button.addEventListener("click", () => {
      this.projectScope = scope;
      this.projectQuery = "";
      this.render();
    });
  }

  private renderProjectCards(parent: HTMLElement, projects: ProjectSummary[]): void {
    parent.empty();
    const query = normalize(this.projectQuery);
    const visible = projects.filter((project) => !query || normalize(project.name).includes(query));
    if (!visible.length) {
      parent.createDiv({
        cls: "fjg-empty",
        text: projects.length ? "No projects match this search." : "Create a project to get started."
      });
      return;
    }
    const registered = new Set(
      this.taskPlugin.workspaceService.listProjects().map((project) => normalize(project.record.name))
    );
    for (const project of visible) {
      const card = parent.createEl("article", { cls: "fjg-project-card" });
      const button = card.createEl("button", {
        cls: "fjg-project-card-main",
        attr: {
          "aria-label": `${project.name}, ${project.openCount} open ${project.openCount === 1 ? "task" : "tasks"}, ${project.totalCount} total ${project.totalCount === 1 ? "task" : "tasks"}`
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
      const actions = card.createDiv({ cls: "fjg-project-card-actions" });
      const total = actions.createSpan({ cls: "fjg-project-total" });
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
      if (canArchiveProject(project) && registered.has(normalize(project.name))) {
        const archive = actions.createEl("button", {
          text: "Archive",
          cls: "fjg-project-archive-button",
          attr: {
            type: "button",
            "aria-label": `Archive project ${project.name}`
          }
        });
        archive.addEventListener("click", () => {
          this.taskPlugin.openArchiveProjectModal(project.name, project.totalCount);
        });
      }
    }
  }

  private renderArchivedProjectCards(
    parent: HTMLElement,
    projects: IndexedProject[],
    tasks: IndexedTask[]
  ): void {
    parent.empty();
    const query = normalize(this.projectQuery);
    const visible = projects.filter((project) => !query || normalize(project.record.name).includes(query));
    if (!visible.length) {
      parent.createDiv({
        cls: "fjg-empty",
        text: projects.length ? "No archived projects match this search." : "No projects have been archived."
      });
      return;
    }
    for (const project of visible) {
      const taskCount = tasks.filter((task) => {
        return task.archived && normalize(task.record.project) === normalize(project.record.name);
      }).length;
      const card = parent.createEl("article", { cls: "fjg-project-card is-archived" });
      const open = card.createEl("button", {
        cls: "fjg-project-card-main",
        attr: {
          type: "button",
          "aria-label": `View archived tasks for ${project.record.name}`
        }
      });
      const iconEl = open.createSpan({ cls: "fjg-project-icon" });
      setIcon(iconEl, "archive");
      const copy = open.createSpan({ cls: "fjg-project-copy" });
      copy.createSpan({ text: project.record.name, cls: "fjg-project-name" });
      copy.createSpan({
        text: countLabel(taskCount, "archived task"),
        cls: "fjg-project-open"
      });
      open.addEventListener("click", () => {
        this.mode = "tasks";
        this.project = project.record.name;
        this.view = "archived";
        this.query = "";
        this.render();
      });
      const actions = card.createDiv({ cls: "fjg-project-card-actions" });
      const reopen = actions.createEl("button", {
        text: "Reopen",
        cls: "fjg-project-reopen-button",
        attr: {
          type: "button",
          "aria-label": `Reopen project ${project.record.name}`
        }
      });
      reopen.addEventListener("click", async () => {
        reopen.disabled = true;
        try {
          await this.taskPlugin.reopenProject(project.record.name);
          this.projectScope = "active";
          this.render();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error), 8000);
        } finally {
          reopen.disabled = false;
        }
      });
    }
  }

  private renderRows(root: HTMLElement): void {
    const rows = root.querySelector<HTMLElement>("[data-fjg-task-rows]");
    if (!rows) return;
    rows.empty();
    const query = normalize(this.query);
    const scopedTasks = this.taskPlugin.workspaceService
      .list({ includeArchived: true })
      .filter((task) => matchesProject(task.record, this.project));
    const viewTasks = this.view === "recent"
      ? mostRecentlyModifiedTasks(scopedTasks
        .filter((task) => taskMatchesView(task.record, this.view, undefined, task.statusAssigned))
        .map((task) => ({
        ...task,
        modifiedAt: task.taskFile.stat.mtime
      })))
      : scopedTasks.filter((task) => taskMatchesView(task.record, this.view, undefined, task.statusAssigned));
    const tasks = viewTasks.filter((task) => taskMatchesSearch(task, query));
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
    const overview = row.createDiv({ cls: "fjg-task-overview" });
    const main = overview.createDiv({ cls: "fjg-task-main" });
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
    const controls = overview.createDiv({ cls: "fjg-task-controls" });
    if (task.archived || task.record.status === "archived") {
      const reopen = controls.createEl("button", {
        text: "Reopen to Do First",
        cls: "mod-cta",
        attr: { "aria-label": `Reopen ${task.record.title} to Do First` }
      });
      reopen.addEventListener("click", async () => {
        try {
          await this.taskPlugin.changeStatus(task.record.task_id, "do-first");
          this.render();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error));
        }
      });
    } else {
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
      const project = controls.createEl("button", {
        cls: "fjg-task-project-picker-button",
        text: task.record.project || "No project",
        attr: { type: "button", "aria-label": `Choose project for ${task.record.title}` }
      });
      project.addEventListener("click", () => this.taskPlugin.openTaskProjectPicker(task.record.task_id));
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
    this.renderRelatedFiles(row, task);
    this.renderRecentUpdates(row, task);
  }

  private renderRelatedFiles(parent: HTMLElement, task: IndexedTask): void {
    const section = parent.createDiv({ cls: "fjg-related-files" });
    const heading = section.createDiv({ cls: "fjg-related-files-heading" });
    const title = heading.createDiv({ cls: "fjg-related-files-title" });
    title.createEl("h3", { text: "Related files" });
    title.createSpan({
      text: String(task.relatedFiles.length),
      cls: "fjg-related-files-count",
      attr: { "aria-label": `${task.relatedFiles.length} related ${task.relatedFiles.length === 1 ? "file" : "files"}` }
    });
    const actions = heading.createDiv({ cls: "fjg-related-file-actions" });
    if (!task.archived) {
      const add = this.iconButton(actions, "paperclip", "Add file", `Add a file to ${task.record.title}`);
      add.addEventListener("click", () => this.taskPlugin.openTaskFileModal(task.record.task_id));
    }
    const copyPath = this.iconButton(
      actions,
      "copy",
      "Copy path",
      `Copy the task attachment folder path for ${task.record.title}`
    );
    copyPath.addEventListener("click", () => void this.taskPlugin.copyTaskFolderPath(task.record.task_id));
    const folder = this.iconButton(actions, "folder-open", "Open folder", `Open the task attachment folder for ${task.record.title}`);
    folder.addEventListener("click", () => void this.taskPlugin.openTaskFolder(task.record.task_id));

    if (!task.relatedFiles.length) {
      section.createEl("p", {
        text: "No related files yet. Add a note, document, PDF, image, or other supporting file.",
        cls: "fjg-no-related-files"
      });
      return;
    }

    const expanded = this.expandedFileTasks.has(task.record.task_id);
    const visible = expanded ? task.relatedFiles : task.relatedFiles.slice(0, 3);
    const grid = section.createDiv({ cls: "fjg-related-file-grid" });
    for (const related of visible) {
      const button = grid.createEl("button", {
        cls: "fjg-related-file-card",
        attr: {
          type: "button",
          "aria-label": `Open ${related.file.name}`
        }
      });
      if (related.kind === "image") {
        button.createEl("img", {
          cls: "fjg-related-file-thumbnail",
          attr: {
            src: this.app.vault.getResourcePath(related.file),
            alt: ""
          }
        });
      } else {
        const icon = button.createSpan({ cls: `fjg-related-file-icon is-${related.kind}` });
        setIcon(icon, relatedFileIcon(related.kind));
      }
      const copy = button.createSpan({ cls: "fjg-related-file-copy" });
      copy.createSpan({ text: related.file.basename, cls: "fjg-related-file-name" });
      if (related.preview) {
        copy.createSpan({ text: related.preview, cls: "fjg-related-file-preview" });
      }
      copy.createSpan({
        text: relatedFileMeta(task.folderPath, related.file.path, related.file.extension, related.file.stat.size),
        cls: "fjg-related-file-meta"
      });
      button.addEventListener("click", () => void this.taskPlugin.openRelatedFile(task.record.task_id, related.file.path));
    }
    if (task.relatedFiles.length > 3) {
      const toggle = section.createEl("button", {
        text: expanded ? "Show fewer files" : `Show all ${task.relatedFiles.length} files`,
        cls: "fjg-related-files-toggle",
        attr: { type: "button" }
      });
      toggle.addEventListener("click", () => {
        if (expanded) this.expandedFileTasks.delete(task.record.task_id);
        else this.expandedFileTasks.add(task.record.task_id);
        this.render();
      });
    }
  }

  private iconButton(
    parent: HTMLElement,
    iconName: string,
    text: string,
    ariaLabel: string
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "fjg-related-file-action",
      attr: { type: "button", "aria-label": ariaLabel }
    });
    const icon = button.createSpan();
    setIcon(icon, iconName);
    button.createSpan({ text });
    return button;
  }

  private renderRecentUpdates(parent: HTMLElement, task: IndexedTask): void {
    const updates = task.updates
      .filter((update) => update.type !== "created")
      .slice(0, 2);
    const section = parent.createDiv({
      cls: "fjg-recent-updates",
      attr: { "aria-live": "polite" }
    });
    const heading = section.createDiv({ cls: "fjg-recent-updates-heading" });
    heading.createEl("h3", { text: "Recent updates" });
    const openLog = heading.createEl("button", {
      text: task.updatesFile ? "View all" : "No update log",
      attr: {
        type: "button",
        "aria-label": `Open all updates for ${task.record.title}`
      }
    });
    openLog.disabled = !task.updatesFile;
    openLog.addEventListener("click", () => this.taskPlugin.openTaskUpdates(task.record.task_id));

    if (!updates.length) {
      section.createEl("p", {
        text: "No task updates yet.",
        cls: "fjg-no-updates"
      });
      return;
    }
    const list = section.createDiv({ cls: "fjg-update-preview-list" });
    for (const update of updates) {
      const card = list.createEl("button", {
        cls: "fjg-update-preview",
        attr: {
          type: "button",
          "aria-label": `Open task ${task.record.title}`
        }
      });
      card.createEl("p", {
        text: updateMeta(update.timestamp, update.actor),
        cls: "fjg-update-preview-meta"
      });
      card.createEl("p", {
        text: update.text,
        cls: "fjg-update-preview-text"
      });
      card.addEventListener("click", () => void this.taskPlugin.openTask(task.record.task_id));
    }
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

function taskCountLabel(count: number): string {
  return countLabel(count, "task");
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function updateMeta(timestamp: string, actor: string): string {
  const dateMatch = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = dateMatch
    ? new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))
    : null;
  const formatted = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(date)
    : timestamp;
  return actor ? `${formatted} · ${actor}` : formatted;
}

function relatedFileIcon(kind: RelatedFileKind): string {
  if (kind === "note") return "notebook-pen";
  if (kind === "pdf") return "file-text";
  if (kind === "document") return "files";
  return "file";
}

function relatedFileMeta(folderPath: string, filePath: string, extension: string, bytes: number): string {
  const relative = filePath.startsWith(`${folderPath}/`)
    ? filePath.slice(folderPath.length + 1)
    : filePath;
  const folder = relative.includes("/") ? `${relative.slice(0, relative.lastIndexOf("/"))} · ` : "";
  const type = extension ? extension.toUpperCase() : "FILE";
  return `${folder}${type} · ${formatFileSize(bytes)}`;
}
