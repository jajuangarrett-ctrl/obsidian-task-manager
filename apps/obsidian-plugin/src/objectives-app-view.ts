import { isConvertedOriginal, statusLabel } from "@fjg/task-core";
import { ItemView, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import type FjgTaskManagerPlugin from "../main";
import { localDateKey, watchLocalDate } from "./dashboard-date";
import { ObjectiveWorkspaceContent } from "./objective-workspace-modal";
import {
  APP_OTHER_VIEWS, APP_QUICK_VIEWS, APP_SCOPES, APP_STATUS_VIEWS, OBJECTIVES_APP_VIEW,
  appFocusIncludes, appSectionGroups, appTaskMatchesSearch, isAppFocus, isAppSectionStatus,
  type AppFocus, type AppSectionStatus,
} from "./objectives-app-model";
import type { IndexedTask } from "./workspace-service";

const PAGE_SIZE = 40;
const PREFERENCES_KEY = "fjg-objectives-app-view";

export class ObjectivesAppView extends ItemView {
  private focus: AppFocus = "overview";
  private query = "";
  private calendarDay = "";
  private readonly collapsed = new Set<AppSectionStatus>();
  private readonly limits = new Map<string, number>();
  private readonly quickButtons = new Map<AppFocus, HTMLButtonElement>();
  private readonly rows = new Map<string, HTMLButtonElement>();
  private selectedId = "";
  private listTop = 0;
  private stopDateWatch?: () => void;
  private directWorkspace?: ObjectiveWorkspaceContent;
  private viewRoot?: HTMLElement;
  private listPane!: HTMLElement;
  private detailPane!: HTMLElement;
  private search!: HTMLInputElement;
  private scopes!: HTMLSelectElement;
  private dateLabel!: HTMLLabelElement;
  private date!: HTMLInputElement;
  private summary!: HTMLElement;
  private listTitle!: HTMLElement;
  private results!: HTMLElement;
  private back?: HTMLButtonElement;
  private detailTitle?: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: FjgTaskManagerPlugin) { super(leaf); }

  getViewType(): string { return OBJECTIVES_APP_VIEW; }
  getDisplayText(): string { return "Objectives App View"; }
  getIcon(): string { return "panels-top-left"; }

  private restorePreferences(): void {
    try {
      const saved = this.app.loadLocalStorage?.(PREFERENCES_KEY) as { focus?: unknown; collapsed?: unknown } | null;
      if (isAppFocus(saved?.focus)) this.focus = saved.focus;
      if (Array.isArray(saved?.collapsed)) {
        this.collapsed.clear();
        for (const key of saved.collapsed) if (isAppSectionStatus(key)) this.collapsed.add(key);
      }
    } catch { /* The view still opens if local preferences are unavailable. */ }
  }

  private savePreferences(): void {
    // Store only a known focus and section keys, never search text, objective IDs, or paths.
    try { this.app.saveLocalStorage?.(PREFERENCES_KEY, { focus: this.focus, collapsed: [...this.collapsed] }); }
    catch { /* In-memory preferences still work. */ }
  }

  async onOpen(): Promise<void> {
    this.restorePreferences();
    const root = this.viewRoot = this.contentEl;
    root.empty();
    root.addClass("fjg-objectives-app");

    const header = root.createEl("header", { cls: "fjg-app-header" });
    const title = header.createDiv({ cls: "fjg-app-title" });
    title.createEl("h1", { text: "FJG Objectives" });
    title.createEl("p", { text: "Objectives App View" });
    const controls = header.createDiv({ cls: "fjg-app-header-actions" });
    this.button(controls, "Talk to Vault", () => this.plugin.openLiveVoice(), "audio-lines");
    this.button(controls, "New objective", () => this.plugin.openQuickCaptureModal(), "plus").addClass("mod-cta");

    const layout = root.createDiv({ cls: "fjg-app-layout" });
    this.listPane = layout.createEl("section", { cls: "fjg-app-list", attr: { "aria-label": "Objective list" } });
    this.detailPane = layout.createEl("section", { cls: "fjg-app-detail", attr: { "aria-label": "Objective details" } });

    const toolbar = this.listPane.createDiv({ cls: "fjg-app-toolbar" });
    const quick = toolbar.createEl("nav", { cls: "fjg-app-quick-views", attr: { "aria-label": "Objective focus views" } });
    for (const [key, label] of APP_QUICK_VIEWS) this.quickButtons.set(key, this.button(quick, label, () => this.chooseFocus(key)));

    const filters = toolbar.createDiv({ cls: "fjg-app-filters" });
    this.search = filters.createEl("input", {
      type: "search", placeholder: "Search objectives", attr: { "aria-label": "Search objectives" },
    });
    this.search.addEventListener("input", () => {
      this.query = this.search.value;
      this.limits.clear();
      this.listPane.scrollTop = 0;
      this.renderList();
    });
    this.scopes = filters.createEl("select", { attr: { "aria-label": "More views and statuses" } });
    this.scopes.createEl("option", { value: "", text: "More views" }).disabled = true;
    const other = this.scopes.createEl("optgroup", { attr: { label: "Focus views" } });
    for (const [key, label] of APP_OTHER_VIEWS) other.createEl("option", { value: key, text: label });
    const statuses = this.scopes.createEl("optgroup", { attr: { label: "Workflow status" } });
    for (const status of APP_STATUS_VIEWS) statuses.createEl("option", { value: `status:${status}`, text: statusLabel(status) });
    this.scopes.addEventListener("change", () => { if (isAppFocus(this.scopes.value)) this.chooseFocus(this.scopes.value); });

    this.dateLabel = toolbar.createEl("label", { text: "Calendar day", cls: "fjg-app-date" });
    this.date = this.dateLabel.createEl("input", { type: "date" });
    this.date.addEventListener("change", () => {
      this.calendarDay = this.date.value;
      this.limits.clear();
      this.renderList();
    });
    const heading = this.listPane.createDiv({ cls: "fjg-app-list-heading" });
    this.listTitle = heading.createEl("h2");
    this.summary = heading.createEl("p", { attr: { "aria-live": "polite" } });
    this.results = this.listPane.createDiv({ cls: "fjg-app-results" });
    this.stopDateWatch = watchLocalDate(() => this.render(), root.ownerDocument.defaultView ?? window, root.ownerDocument);
    this.render();
  }

  async onClose(): Promise<void> {
    this.stopDateWatch?.();
    this.stopDateWatch = undefined;
    this.directWorkspace?.dispose();
    this.directWorkspace = undefined;
    this.quickButtons.clear();
    this.rows.clear();
    this.viewRoot?.empty();
    this.viewRoot?.removeClass("fjg-objectives-app", "has-objective");
    this.viewRoot = undefined;
  }

  render(): void {
    if (!this.viewRoot) return;
    this.renderList();
    if (this.selectedId) this.directWorkspace?.refresh();
    else this.showEmptyDetail();
  }

  private chooseFocus(key: AppFocus): void {
    if (key === this.focus) return;
    this.focus = key;
    this.limits.clear();
    this.listPane.scrollTop = 0;
    this.closeDetail(false);
    this.savePreferences();
  }

  private renderList(): void {
    const tasks = this.plugin.workspaceService.list({ includeArchived: true });
    const today = localDateKey();
    const context = { today, inboxRoot: this.plugin.settings.inboxRoot, calendarDay: this.calendarDay };
    const scoped = tasks.filter(task => appFocusIncludes(task, this.focus, context));
    const query = this.query.trim();
    const matches = query ? scoped.filter(task => appTaskMatchesSearch(task, query)) : scoped;

    for (const [key, button] of this.quickButtons) button.setAttribute("aria-pressed", String(this.focus === key));
    this.scopes.value = this.quickButtons.has(this.focus) ? "" : this.focus;
    this.dateLabel.hidden = this.focus !== "calendar";
    this.date.value = this.calendarDay || today;
    this.listTitle.textContent = APP_SCOPES.find(([key]) => key === this.focus)?.[1] ?? "Overview";
    this.summary.textContent = query
      ? `${matches.length} of ${scoped.length} objectives`
      : `${scoped.length} objective${scoped.length === 1 ? "" : "s"}`;

    const oldTop = this.listPane.scrollTop;
    const active = this.results.ownerDocument.activeElement;
    const restore = active instanceof HTMLElement && this.results.contains(active) ? active.dataset.appFocus : undefined;
    this.rows.clear();
    this.results.empty();
    if (this.focus === "overview" && (!query || matches.length)) {
      for (const { status, tasks: group } of appSectionGroups(matches, !!query)) {
        const section = this.results.createEl("section", { cls: "fjg-app-section" });
        const heading = section.createEl("h3");
        const expanded = !!query || !this.collapsed.has(status);
        if (!query) {
          const toggle = this.button(heading, statusLabel(status), () => {
            if (expanded) this.collapsed.add(status); else this.collapsed.delete(status);
            this.renderList();
            this.savePreferences();
          }, expanded ? "chevron-down" : "chevron-right");
          toggle.dataset.appFocus = `section-${status}`;
          toggle.setAttribute("aria-expanded", String(expanded));
          toggle.createSpan({ text: String(group.length), cls: "fjg-app-section-count" });
        } else heading.textContent = `${statusLabel(status)} · ${group.length}`;
        if (expanded) this.renderCards(section, group, status, today);
      }
    } else if (matches.length) this.renderCards(this.results, matches, "results", today);
    else this.results.createEl("p", { cls: "fjg-app-empty", text: query ? "No objectives match. Try a different search." : "No objectives in this view." });
    this.listPane.scrollTop = oldTop;
    if (restore) Array.from(this.results.querySelectorAll<HTMLElement>("[data-app-focus]"))
      .find(control => control.dataset.appFocus === restore)?.focus({ preventScroll: true });
  }

  private renderCards(parent: HTMLElement, tasks: IndexedTask[], section: string, today: string): void {
    const limit = this.limits.get(section) ?? PAGE_SIZE;
    const list = parent.createEl("ul", { cls: "fjg-app-cards" });
    for (const task of tasks.slice(0, limit)) {
      const { record } = task;
      const id = record.task_id;
      const item = list.createEl("li");
      const card = item.createEl("button", { cls: "fjg-app-card", attr: { type: "button" } });
      card.dataset.appFocus = `row-${id}`;
      card.setAttribute("aria-current", this.selectedId === id ? "true" : "false");
      this.rows.set(id, card);
      card.createSpan({ text: record.title, cls: "fjg-app-card-title" });
      const data = card.createSpan({ cls: "fjg-app-card-meta" });
      const status = isConvertedOriginal(record) ? "Converted original" : task.statusAssigned ? statusLabel(record.status) : "Unassigned status";
      data.createSpan({ text: status, cls: "fjg-app-status" });
      if (record.due) data.createSpan({ text: record.due === today ? "Due today" : `Due ${record.due}` });
      if (record.subtasks.length) data.createSpan({ text: `${record.subtasks.filter(action => action.completed).length}/${record.subtasks.length} actions` });
      if (record.project) data.createSpan({ text: record.project });
      if (record.priority === "high") data.createSpan({ text: "High priority" });
      card.addEventListener("click", () => this.openDetail(id));
    }
    if (!tasks.length) parent.createEl("p", { text: "No objectives", cls: "fjg-app-empty" });
    if (tasks.length > limit) {
      const more = this.button(parent, `Show ${Math.min(PAGE_SIZE, tasks.length - limit)} more`, () => {
        this.limits.set(section, limit + PAGE_SIZE);
        this.renderList();
        this.rows.get(tasks[limit].record.task_id)?.focus();
      });
      more.addClass("fjg-app-show-more");
    }
  }

  private openDetail(id: string): void {
    let task: IndexedTask;
    try { task = this.plugin.workspaceService.getById(id); }
    catch (error) { new Notice(error instanceof Error ? error.message : "That objective is unavailable."); return; }
    if (!this.selectedId || this.listPane.getClientRects().length) this.listTop = this.listPane.scrollTop;
    if (this.selectedId === id) { this.back?.focus(); return; }

    this.directWorkspace?.dispose();
    this.selectedId = id;
    this.viewRoot?.addClass("has-objective");
    this.detailPane.empty();
    const heading = this.detailPane.createDiv({ cls: "fjg-app-detail-heading" });
    this.back = this.button(heading, "Back to objectives", () => this.closeDetail(), "arrow-left");
    this.detailTitle = heading.createEl("h2", { text: task.record.title });
    const body = this.detailPane.createDiv({ cls: "fjg-app-detail-body" });
    this.directWorkspace = new ObjectiveWorkspaceContent(this.app, this.plugin, id, body, title => {
      if (this.detailTitle) this.detailTitle.textContent = title;
    }, false, false, "app");
    this.directWorkspace.refresh();
    this.detailPane.scrollTop = 0;
    for (const [taskId, card] of this.rows) card.setAttribute("aria-current", String(taskId === id));
    this.back.focus({ preventScroll: true });
  }

  private closeDetail(restoreList = true): void {
    const savedTop = this.listTop;
    const id = this.selectedId;
    this.selectedId = "";
    this.directWorkspace?.dispose();
    this.directWorkspace = undefined;
    this.back = this.detailTitle = undefined;
    this.viewRoot?.removeClass("has-objective");
    this.showEmptyDetail();
    this.renderList();
    if (id && restoreList) {
      this.listPane.scrollTop = savedTop;
      (this.rows.get(id) ?? this.search).focus({ preventScroll: true });
    }
  }

  private showEmptyDetail(): void {
    this.detailPane.empty();
    const empty = this.detailPane.createDiv({ cls: "fjg-app-placeholder" });
    setIcon(empty.createSpan(), "list-checks");
    empty.createEl("h2", { text: "Select an objective" });
    empty.createEl("p", { text: "Choose from the list to see its actions, files, and updates." });
  }

  private button(parent: HTMLElement, label: string, onClick: () => void, icon?: string): HTMLButtonElement {
    const b = parent.createEl("button", { attr: { type: "button" } });
    if (icon) setIcon(b.createSpan({ attr: { "aria-hidden": "true" } }), icon);
    b.createSpan({ text: label });
    b.addEventListener("click", onClick);
    return b;
  }
}
