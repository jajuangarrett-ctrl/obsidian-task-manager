import { ItemView, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import { statusLabel, TASK_STATUSES } from "@fjg/task-core";
import type { TaskStatus } from "@fjg/task-core";
import type FjgTaskManagerPlugin from "../main";
import { DashboardProjectPickerModal } from "./modals";
import {
  ALL_PROJECTS,
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
import type { IndexedTask } from "./workspace-service";
import { ConvertSubtasksModal, PromoteSubtaskModal, SubtaskEditModal, SubtaskVaultFileModal } from "./subtask-modals";
import { TaskFileModal } from "./modals";
import { taskFolderClipboardPath } from "./task-folder-path";

export const TASK_DASHBOARD_VIEW = "fjg-task-manager-dashboard";

export class TaskDashboardView extends ItemView {
  private mode: DashboardMode = "tasks";
  private query = "";
  private projectQuery = "";
  private view: TaskViewKey = "do-first";
  private project = ALL_PROJECTS;
  private readonly expandedUpdateTasks = new Set<string>();
  private readonly expandedSubtasks = new Set<string>();

  constructor(leaf: WorkspaceLeaf, private readonly taskPlugin: FjgTaskManagerPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return TASK_DASHBOARD_VIEW;
  }

  getDisplayText(): string {
    return "FJG Objective Manager";
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
    if (this.mode === "kanban") {
      this.renderKanban(root, allTasks.filter((task) => task.record.status !== "archived"));
    } else {
      this.renderTasks(root, allTasks, projects);
    }
  }

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: "fjg-task-header" });
    const titleWrap = header.createDiv();
    titleWrap.createEl("p", { text: "OBJECTIVE WORKSPACES", cls: "fjg-eyebrow" });
    titleWrap.createEl("h1", { text: "FJG Objective Manager" });
    const actions = header.createDiv({ cls: "fjg-header-actions" });
    const voiceButton = actions.createEl("button", { text: "Talk to dashboard", cls: "fjg-live-trigger",
      attr: { "aria-label": "Talk to dashboard with GPT-Live", title: "Ask about objectives and make updates by voice" } });
    const micIcon = voiceButton.createSpan();
    setIcon(micIcon, "mic");
    voiceButton.addEventListener("click", () => this.taskPlugin.openLiveVoice(() =>
      JSON.stringify({ mode: this.mode, view: this.view, project: this.project, search: this.query })));
    const createButton = actions.createEl("button", { text: "Capture objective", cls: "mod-cta" });
    createButton.addEventListener("click", () => this.taskPlugin.openQuickCaptureModal());
    const captureAction = actions.createEl("button", { text: "Capture action" });
    captureAction.addEventListener("click", () => new SubtaskEditModal(this.app, null, async (title, due, notes, status, parentId) => {
      if (!parentId) throw new Error("Choose a parent objective.");
      await this.taskPlugin.workspaceService.addSubtask(parentId, title, { due, notes, status });
      this.expandedSubtasks.add(parentId);
      this.render();
      new Notice("Action captured.");
    }, this.taskPlugin.workspaceService).open());
    const convert = actions.createEl("button", { text: "Convert objectives to actions" });
    convert.addEventListener("click", () => new ConvertSubtasksModal(this.app, this.taskPlugin.workspaceService, () => this.render()).open());
    const briefingButton = actions.createEl("button", {
      text: "Open objective briefing",
      attr: {
        title: "Refresh and open the Objective Manager briefing for Claudian",
        "aria-label": "Refresh and open Objective Manager briefing"
      }
    });
    briefingButton.addEventListener("click", () => void this.taskPlugin.openTaskBriefing());
    const refreshButton = actions.createEl("button", { text: "Refresh" });
    refreshButton.setAttribute("title", "Refresh objectives and regenerate the Objective Manager briefing");
    refreshButton.setAttribute("aria-label", "Refresh objectives and regenerate Objective Manager briefing");
    refreshButton.addEventListener("click", async () => {
      await this.taskPlugin.workspaceService.refresh();
      this.render();
    });
  }

  private renderSectionTabs(root: HTMLElement, projectCount: number, taskCount: number): void {
    const tabs = root.createDiv({
      cls: "fjg-dashboard-tabs",
      attr: { role: "tablist", "aria-label": "Objective Manager sections" }
    });
    this.sectionTab(tabs, "tasks", "Objectives", "list-checks");
    this.sectionTab(tabs, "kanban", "Kanban", "columns-3", taskCount);
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
    projects = projects.map((project) => project.key === NO_PROJECT ? { ...project, name: "No objective tag" } : project);
    const activeProject = projects.find((project) => project.key === this.project);
    const selectedRecords = tasks
      .filter((task) => matchesProject(task.record, this.project))
      .filter((task) => this.view === "archived" || task.record.status !== "archived");
    const selectedName = this.project === NO_PROJECT ? "No objective tag" : this.project;
    if (this.project !== ALL_PROJECTS) this.renderActiveProject(root);

    const heading = root.createDiv({ cls: "fjg-section-heading" });
    const headingCopy = heading.createDiv();
    headingCopy.createEl("h2", {
      text: this.project === ALL_PROJECTS ? "Objective Views" : (activeProject?.name || selectedName)
    });
    headingCopy.createEl("p", {
      text: this.project !== ALL_PROJECTS
        ? `${selectedRecords.filter((task) => task.record.status !== "completed" && task.record.status !== "archived").length} open · ${selectedRecords.length} total`
        : "Choose a focus and keep the rest of the dashboard quiet."
    });

    const viewNav = root.createDiv({
      cls: "fjg-view-grid",
      attr: { "aria-label": "Objective views" }
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
      attr: { "aria-label": "Search objectives in the current view" }
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
          name: "No objective tag",
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
      text: this.project === ALL_PROJECTS ? "All objective tags" : (projectOptions.find((option) => option.key === this.project)?.name || selectedName),
      attr: { type: "button", "aria-label": "Filter objectives by objective tag" }
    });
    projectPicker.addEventListener("click", () => {
      new DashboardProjectPickerModal(
        this.app,
        this.project,
        [
          { key: ALL_PROJECTS, name: "All objective tags" },
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
      text: "Scan every objective by status. Drag cards between columns or use the status menu on a card."
    });
    heading.createSpan({
      text: taskCountLabel(tasks.length),
      cls: "fjg-kanban-total"
    });

    const board = root.createDiv({
      cls: "fjg-kanban-board",
      attr: { "aria-label": "Objectives grouped by status" }
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
        cards.createDiv({ text: "Drop objectives here", cls: "fjg-kanban-empty" });
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
    this.renderSubtasks(card, task);

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
    back.createSpan({ text: "All objective tags" });
    back.addEventListener("click", () => {
      this.mode = "projects";
      this.render();
    });
  }

  private renderProjects(root: HTMLElement, projects: ProjectSummary[], _tasks: IndexedTask[]): void {
    const heading = root.createDiv({ cls: "fjg-section-heading fjg-project-heading" });
    const copy = heading.createDiv();
    copy.createEl("h2", { text: "Projects" });
    copy.createEl("p", {
      text: "Projects are gathered by tag across every Program and Area folder."
    });
    const namedProjectCount = projects.filter((project) => project.key !== NO_PROJECT).length;
    const totalOpen = projects.reduce((total, project) => total + project.openCount, 0);
    heading.createSpan({
      text: `${countLabel(namedProjectCount, "project")} · ${totalOpen} open ${totalOpen === 1 ? "task" : "tasks"}`,
      cls: "fjg-project-rollup"
    });

    const tools = root.createDiv({ cls: "fjg-project-tools" });
    const search = tools.createEl("input", {
      type: "search",
      placeholder: "Search objective tags",
      attr: { "aria-label": "Search objective tags" }
    });
    search.value = this.projectQuery;
    const listHeader = root.createDiv({
      cls: "fjg-project-list-header",
      attr: { "aria-hidden": "true" }
    });
    listHeader.createSpan({ text: "Project" });
    listHeader.createSpan({ text: "Open" });
    listHeader.createSpan({ text: "Total" });
    listHeader.createSpan({ text: "Actions" });
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
        text: projects.length ? "No objective tags match this search." : "Assign an objective tag to an objective to get started."
      });
      return;
    }
    for (const project of visible) {
      const card = parent.createEl("article", { cls: "fjg-project-card" });
      const button = card.createEl("button", {
        cls: "fjg-project-card-main",
        attr: {
          "aria-label": `${project.name}, ${project.openCount} open ${project.openCount === 1 ? "task" : "tasks"}, ${project.totalCount} total ${project.totalCount === 1 ? "task" : "tasks"}`
        }
      });
      const iconEl = button.createSpan({ cls: "fjg-project-icon" });
      setIcon(iconEl, project.key === NO_PROJECT ? "inbox" : "tag");
      const copy = button.createSpan({ cls: "fjg-project-copy" });
      copy.createSpan({ text: project.name, cls: "fjg-project-name" });
      const openCount = card.createSpan({
        text: String(project.openCount),
        cls: "fjg-project-open",
        attr: { "aria-label": `${project.openCount} open ${project.openCount === 1 ? "task" : "tasks"}` }
      });
      openCount.setAttribute("title", `${project.openCount} open ${project.openCount === 1 ? "task" : "tasks"}`);
      const total = card.createSpan({
        text: String(project.totalCount),
        cls: "fjg-project-total",
        attr: { "aria-label": `${project.totalCount} total ${project.totalCount === 1 ? "task" : "tasks"}` }
      });
      total.setAttribute("title", `${project.totalCount} total ${project.totalCount === 1 ? "task" : "tasks"}`);
      const actions = card.createDiv({ cls: "fjg-project-card-actions" });
      const openProject = (): void => {
        this.mode = "tasks";
        this.project = project.key;
        this.view = "all-open";
        this.query = "";
        this.render();
      };
      button.addEventListener("click", openProject);
      const open = actions.createEl("button", {
        cls: "fjg-project-open-button",
        attr: { type: "button", "aria-label": `Open project ${project.name}` }
      });
      open.createSpan({ text: "Open" });
      const chevron = open.createSpan({ cls: "fjg-project-chevron" });
      setIcon(chevron, "chevron-right");
      open.addEventListener("click", openProject);
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
      rows.createDiv({ cls: "fjg-empty", text: "No objectives match this view." });
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
    if (task.archived || task.record.status === "archived") {
      meta.createSpan({
        text: statusLabel(task.record.status),
        cls: `fjg-status-badge is-${task.record.status}`
      });
      if (task.record.project) meta.createSpan({ text: task.record.project, cls: "fjg-task-static-meta" });
      if (task.record.due) {
        meta.createSpan({
          text: `Due ${task.record.due}`,
          cls: `fjg-task-static-meta${isDueOrOverdue(task.record) ? " is-overdue" : ""}`
        });
      }
    } else {
      const status = meta.createEl("select", {
        cls: "fjg-task-meta-control fjg-task-status-select",
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
      const project = meta.createEl("button", {
        cls: "fjg-task-meta-control fjg-task-project-picker-button",
        text: task.record.project || "No objective tag",
        attr: { type: "button", "aria-label": `Choose objective tag for ${task.record.title}` }
      });
      project.addEventListener("click", () => this.taskPlugin.openTaskProjectPicker(task.record.task_id));
      const dueDate = meta.createEl("button", {
        cls: `fjg-task-meta-control fjg-task-due-date-button${task.record.due ? "" : " is-empty"}${isDueOrOverdue(task.record) ? " is-overdue" : ""}`,
        text: task.record.due ? `Due ${task.record.due}` : "Add due date",
        attr: {
          type: "button",
          "aria-label": task.record.due
            ? `Change due date for ${task.record.title}, currently ${task.record.due}`
            : `Add a due date to ${task.record.title}`
        }
      });
      dueDate.addEventListener("click", () => this.taskPlugin.openTaskDueDateModal(task.record.task_id));
    }
    if (task.record.delegated_to) {
      meta.createSpan({ text: `Delegated to ${task.record.delegated_to}`, cls: "fjg-task-static-meta" });
    }

    const controls = overview.createDiv({ cls: "fjg-task-controls" });
    const folder = controls.createEl("button", {
      cls: "fjg-task-folder-button",
      attr: { type: "button", "aria-label": `Open objective Files folder in Finder for ${task.record.title}` }
    });
    const folderIcon = folder.createSpan();
    setIcon(folderIcon, "folder-open");
    folder.createSpan({ text: "Folder" });
    folder.addEventListener("click", () => void this.taskPlugin.openTaskFileLocation(task.record.task_id));
    const fileFocusLocation = controls.createEl("button", {
      text: "Show in file",
      cls: "fjg-task-file-focus-button",
      attr: {
        type: "button",
        "aria-label": `Reveal the objective Files location in FJG File Focus for ${task.record.title}`
      }
    });
    fileFocusLocation.addEventListener("click", () => void this.taskPlugin.showTaskFileLocationInFileFocus(task.record.task_id));
    const copyPath = controls.createEl("button", {
      cls: "fjg-task-copy-path-button",
      attr: { type: "button", "aria-label": `Copy the objective attachment folder path for ${task.record.title}` }
    });
    const copyPathIcon = copyPath.createSpan();
    setIcon(copyPathIcon, "copy");
    copyPath.createSpan({ text: "Copy" });
    copyPath.addEventListener("click", () => void this.taskPlugin.copyTaskFolderPath(task.record.task_id));
    if (task.archived || task.record.status === "archived") {
      const reopen = controls.createEl("button", {
        text: "Reopen to Do First",
        cls: "mod-cta",
        attr: { type: "button", "aria-label": `Reopen ${task.record.title} to Do First` }
      });
      reopen.addEventListener("click", async () => {
        try {
          await this.taskPlugin.changeStatus(task.record.task_id, "do-first");
          this.render();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error));
        }
      });
      const rename = controls.createEl("button", {
        text: "Rename",
        cls: "fjg-task-rename-button",
        attr: { type: "button", "aria-label": `Rename objective ${task.record.title}` }
      });
      rename.addEventListener("click", () => this.taskPlugin.openRenameTaskModal(task.record.task_id));
    } else {
      const update = controls.createEl("button", {
        text: "Update",
        cls: "mod-cta fjg-task-update-button",
        attr: { type: "button", "aria-label": `Add an update to ${task.record.title}` }
      });
      update.addEventListener("click", () => this.taskPlugin.openUpdateModal(task.record.task_id));
      const more = controls.createEl("details", { cls: "fjg-task-more" });
      more.createEl("summary", {
        text: "More",
        attr: { "aria-label": `More actions for ${task.record.title}` }
      });
      const menu = more.createDiv({ cls: "fjg-task-more-menu" });
      const rename = menu.createEl("button", {
        text: "Rename",
        cls: "fjg-task-rename-button",
        attr: { type: "button", "aria-label": `Rename objective ${task.record.title}` }
      });
      rename.addEventListener("click", () => this.taskPlugin.openRenameTaskModal(task.record.task_id));
      const relocate = menu.createEl("button", {
        text: "Move folder",
        attr: {
          type: "button",
          "aria-label": `Move ${task.record.title} to a Program or Area folder`
        }
      });
      relocate.addEventListener("click", () => this.taskPlugin.openTaskRelocationModal(task.record.task_id));
      const addFile = menu.createEl("button", {
        text: "Add file",
        attr: { type: "button", "aria-label": `Add a file to ${task.record.title}` }
      });
      addFile.addEventListener("click", () => this.taskPlugin.openTaskFileModal(task.record.task_id));
      const convert = menu.createEl("button", { text: "Convert to action" });
      convert.addEventListener("click", () => new ConvertSubtasksModal(this.app, this.taskPlugin.workspaceService, () => this.render(), task.record.task_id).open());
      const archive = menu.createEl("button", {
        text: "Archive",
        attr: { type: "button", "aria-label": `Archive ${task.record.title}` }
      });
      archive.addEventListener("click", () => {
        more.open = false;
        this.taskPlugin.openArchiveTaskModal(task.record.task_id);
      });
    }
    this.renderSubtasks(row, task);
    this.renderRecentUpdates(row, task);
  }

  private renderSubtasks(parent: HTMLElement, task: IndexedTask): void {
    const service = this.taskPlugin.workspaceService;
    const taskId = task.record.task_id;
    const subs = task.record.subtasks;
    const section = parent.createEl("details", { cls: "fjg-subtasks" });
    section.open = this.expandedSubtasks.has(taskId);
    section.addEventListener("toggle", () => { if (section.open) this.expandedSubtasks.add(taskId); else this.expandedSubtasks.delete(taskId); });
    const summary = section.createEl("summary", { text: subs.length ? `Actions · ${subs.filter((sub) => sub.completed).length} of ${subs.length} complete` : "Actions · Add your first step" });
    if (subs.length) {
      const progress = summary.createEl("progress", { attr: { max: String(subs.length), value: String(subs.filter((sub) => sub.completed).length), "aria-label": "Action completion" } });
      progress.addClass("fjg-subtask-progress");
    }
    const run = async (action: () => Promise<unknown>) => { try { await action(); this.render(); } catch (error) { new Notice(String(error), 8000); } };
    for (const [index, sub] of subs.entries()) {
      const item = section.createDiv({ cls: "fjg-subtask-item" });
      const line = item.createDiv({ cls: "fjg-subtask-line" });
      const check = line.createEl("input", { type: "checkbox", attr: { "aria-label": `Complete action ${sub.title}` } });
      check.checked = sub.completed; check.disabled = task.archived;
      check.addEventListener("change", () => void run(() => service.updateSubtask(taskId, sub.id, { status: check.checked ? "completed" : "do-soon" })));
      line.createSpan({ text: sub.title, cls: sub.completed ? "fjg-subtask-done" : "fjg-subtask-title" });
      line.createSpan({ text: statusLabel(sub.status), cls: "fjg-task-static-meta" });
      if (sub.due) line.createSpan({ text: `Due ${sub.due}`, cls: "fjg-task-static-meta" });
      const copy = line.createEl("button", { text: "Copy path", attr: { "aria-label": `Copy action folder path for ${sub.title}` } });
      copy.addEventListener("click", () => void run(async () => { await navigator.clipboard.writeText(taskFolderClipboardPath(await service.ensureSubtaskFolder(taskId, sub.id))); new Notice("Action folder path copied."); }));
      if (!task.archived) {
        for (const direction of ["up", "down"] as const) {
          const move = line.createEl("button", { text: direction === "up" ? "↑ Move up" : "↓ Move down", cls: "fjg-action-move",
            attr: { "aria-label": `Move action ${sub.title} ${direction}` } });
          move.disabled = direction === "up" ? index === 0 : index === subs.length - 1;
          move.addEventListener("click", () => {
            section.querySelectorAll<HTMLButtonElement>(".fjg-action-move").forEach((button) => { button.disabled = true; });
            this.expandedSubtasks.add(taskId);
            void run(() => service.moveSubtask(taskId, sub.id, direction)).finally(() => this.render());
          });
        }
        const edit = line.createEl("button", { text: "Edit" });
        edit.addEventListener("click", () => new SubtaskEditModal(this.app, sub, async (title, due, notes, status) => { await service.updateSubtask(taskId, sub.id, { title, due, notes, status }); this.render(); }).open());
        const attach = line.createEl("button", { text: "Attach file", attr: { "aria-label": `Attach file to action ${sub.title}` } });
        attach.addEventListener("click", () => new TaskFileModal(this.app, sub.title,
          async (title, body) => { const file = await service.addSubtaskNote(taskId, sub.id, title, body); this.render(); await this.app.workspace.getLeaf("tab").openFile(file); },
          async (files) => { await service.importSubtaskFiles(taskId, sub.id, files); this.render(); }, "action").open());
        const existing = line.createEl("button", { text: "From vault" });
        existing.addEventListener("click", () => new SubtaskVaultFileModal(this.app, async (file) => { await service.copyVaultFileToSubtask(taskId, sub.id, file); this.render(); }).open());
        const promote = line.createEl("button", { text: "Promote" });
        promote.addEventListener("click", () => new PromoteSubtaskModal(this.app, sub.title, async () => { await service.promoteSubtask(taskId, sub.id); this.render(); }).open());
      }
      // Keep preserved notes in Edit/promotion, not in the compact Action display.
      let files;
      try { files = service.subtaskFiles(taskId, sub.id); } catch (error) { item.createEl("p", { text: String(error) }); continue; }
      const attachments = item.createEl("details");
      attachments.createEl("summary", { text: `${files.length} ${files.length === 1 ? "file" : "files"}` });
      for (const file of files) {
        const link = attachments.createEl("button", { text: file.name, attr: { title: file.path } });
        link.addEventListener("click", () => void this.app.workspace.getLeaf("tab").openFile(file));
      }
      if (sub.history) {
        const history = item.createEl("details"); history.createEl("summary", { text: "Preserved update history" });
        history.createEl("pre", { text: sub.history, cls: "fjg-subtask-notes" });
      }
    }
    if (!task.archived) {
      const add = section.createEl("button", { text: "+ Add action" });
      add.addEventListener("click", () => new SubtaskEditModal(this.app, null, async (title, due, notes, status) => {
        await service.addSubtask(taskId, title, { due, notes, status });
        this.expandedSubtasks.add(taskId); this.render();
      }).open());
    }
  }

  private renderRecentUpdates(parent: HTMLElement, task: IndexedTask): void {
    const updates = task.updates
      .filter((update) => update.type !== "created");
    if (!updates.length) return;
    const expanded = this.expandedUpdateTasks.has(task.record.task_id);
    const section = parent.createDiv({
      cls: `fjg-recent-updates${expanded ? " is-expanded" : ""}`,
      attr: { "aria-live": "polite" }
    });
    const heading = section.createDiv({ cls: "fjg-recent-updates-heading" });
    const headingTitle = heading.createDiv({ cls: "fjg-recent-updates-title" });
    headingTitle.createEl("h3", { text: "Recent updates" });
    headingTitle.createSpan({
      text: String(updates.length),
      cls: "fjg-recent-updates-count",
      attr: { "aria-label": `${updates.length} objective ${updates.length === 1 ? "update" : "updates"}` }
    });
    const actions = heading.createDiv({ cls: "fjg-recent-updates-actions" });
    if (updates.length > 1) {
      const toggle = actions.createEl("button", {
        text: expanded ? "Collapse" : "Expand",
        attr: {
          type: "button",
          "aria-expanded": String(expanded),
          "aria-label": `${expanded ? "Collapse" : "Expand"} update history for ${task.record.title}`
        }
      });
      toggle.addEventListener("click", () => {
        if (expanded) this.expandedUpdateTasks.delete(task.record.task_id);
        else this.expandedUpdateTasks.add(task.record.task_id);
        this.render();
      });
    }
    const openLog = actions.createEl("button", {
      text: task.updatesFile ? "View all" : "No update log",
      attr: {
        type: "button",
        "aria-label": `Open all updates for ${task.record.title}`
      }
    });
    openLog.disabled = !task.updatesFile;
    openLog.addEventListener("click", () => this.taskPlugin.openTaskUpdates(task.record.task_id));

    const list = section.createDiv({ cls: "fjg-update-preview-list" });
    for (const update of expanded ? updates : updates.slice(0, 1)) {
      const card = list.createEl("button", {
        cls: "fjg-update-preview",
        attr: {
          type: "button",
          "aria-label": `Open objective ${task.record.title}`
        }
      });
      card.createSpan({
        text: updateMeta(update.timestamp, update.actor),
        cls: "fjg-update-preview-meta"
      });
      card.createSpan({
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
    task.record.status,
    ...task.record.subtasks.map((sub) => `${sub.title} ${sub.notes}`)
  ].join(" ")).includes(query);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function taskCountLabel(count: number): string {
  return countLabel(count, "objective");
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
