import { expect, it, vi } from "vitest";
import type { IndexedTask } from "./workspace-service";

const obsidian = vi.hoisted(() => ({ platform: { isMobile: true } }));
vi.mock("obsidian", () => ({
  Platform: obsidian.platform, ItemView: class {}, Modal: class {},
  Component: class { load() {} unload() {} }, TFile: class {}, TFolder: class {},
  setIcon: vi.fn(), Menu: class {}, Notice: class {}, MarkdownRenderer: { render: vi.fn() }
}));
vi.mock("./modals", () => ({ DashboardProjectPickerModal: class {}, TaskFileModal: class {} }));
vi.mock("./subtask-modals", () => ({ ConvertSubtasksModal: class {}, PromoteSubtaskModal: class {}, SubtaskEditModal: class {}, SubtaskVaultFileModal: class {} }));
vi.mock("./conversion-ui", () => ({ renderConversion: vi.fn() }));
vi.mock("./objective-more-menu", () => ({ renderObjectiveMoreMenu: vi.fn() }));
import { TaskDashboardView } from "./dashboard-view";

class Element {
  text: string;
  classes: Set<string>;
  attrs: Record<string,string>;
  children: Element[] = [];
  handlers: Record<string, () => unknown> = {};
  dataset: Record<string,string> = {};
  style = { removeProperty() {} };
  scrollTop = 0;
  scrollLeft = 0;
  hidden = false;
  focused = false;
  disabled = false;
  checked = false;
  open = false;
  value = "";
  type = "";
  selectionStart = null;
  constructor(readonly tag = "div", options: { cls?: string; text?: string; attr?: Record<string,string> } = {}) {
    this.text = options.text ?? "";
    this.classes = new Set(options.cls?.split(" ") ?? []);
    this.attrs = { ...options.attr };
    const id = this.attrs["data-task-id"];
    if (id) this.dataset.taskId = id;
  }
  createEl(tag: string, options?: ConstructorParameters<typeof Element>[1]) { const child = new Element(tag, options); this.children.push(child); return child; }
  createDiv(options?: ConstructorParameters<typeof Element>[1]) { return this.createEl("div", options); }
  createSpan(options?: ConstructorParameters<typeof Element>[1]) { return this.createEl("span", options); }
  addClass(cls: string) { this.classes.add(cls); }
  toggleClass(cls: string, value: boolean) { if (value) this.classes.add(cls); else this.classes.delete(cls); }
  setAttribute(key: string,value: string) { this.attrs[key] = value; }
  addEventListener(name: string, handler: () => unknown) { this.handlers[name] = handler; }
  focus() { this.focused = true; }
  appendChild(child: Element) { this.children.push(child); }
  empty() { this.children = []; }
  isShown() { return true; }
  contains(el: Element): boolean { return this === el || this.children.some(child => child.contains(el)); }
  all(): Element[] { return this.children.flatMap(child => [child, ...child.all()]); }
  querySelectorAll(selector: string): Element[] { return selector.startsWith(".") ? this.all().filter(el => el.classes.has(selector.slice(1))) : []; }
  querySelector(selector: string): Element | undefined { return this.querySelectorAll(selector)[0]; }
  findText(label: string) { return this.all().find(el => el.text === label); }
}

function setup(mobile: boolean) {
  obsidian.platform.isMobile = mobile;
  vi.stubGlobal("createDiv", (options: ConstructorParameters<typeof Element>[1]) => new Element("div", options));
  const task = {
    record: { task_id: "goal-1", title: "Long objective title", project: "", status: "waiting", created_at: "", updated_at: "2026-11-19", subtasks: [{ id: "step-id", title: "First step", completed: false, status: "ongoing" }], people: [] },
    taskFile: { path: "Vault/Objective/task.md" }, archived: false
  } as unknown as IndexedTask;
  const file = { name: "Evidence.pdf", path: "Vault/Objective/Files/Evidence.pdf" };
  const globals = new Element();
  const root = globals.createDiv();
  const container = new Element();
  container.children = [new Element(), root];
  const openFile = vi.fn();
  const app = { workspace: { getLeaf: () => ({ openFile }) } };
  const plugin = {
    workspaceService: {
      list: () => [task], projectNames: () => [], getById: () => task,
      startHereFile: () => null, objectiveFiles: () => [{ file }], updateSubtask: vi.fn()
    },
    copyTaskFolderPath: vi.fn(), showTaskFileLocationInFileFocus: vi.fn(),
    openUpdateModal: vi.fn(), openObjectiveActionModal: vi.fn(), openObjectiveFileReview: vi.fn(), openObjectiveChat: vi.fn(),
    openTask: vi.fn(), openPeoplePicker: vi.fn(), refreshDashboard: vi.fn()
  };
  const view = Object.assign(Object.create(TaskDashboardView.prototype), {
    containerEl: container, mode: "overview", overviewSelected: "", overviewQuery: "Long", overviewWorkspaceId: "",
    focusHome: {snapshot: vi.fn()}, rowPositions: new Map(), collapsedOverviewStatuses: new Set(["delegate"]), app, taskPlugin: plugin,
    renderHeader: (node: Element) => node.createDiv({ cls: "test-dashboard-header" }), renderSectionTabs: (node: Element) => node.createDiv({ cls: "fjg-dashboard-tabs" }),
    cancelSearchRender: vi.fn()
  }) as TaskDashboardView;
  root.scrollTop = 128;
  view.render();
  return { view, root, plugin, openFile, file };
}

it("opens on-mobile actions in a full-pane route and restores list context and focus on Back", async () => {
  const { root, plugin, openFile, file } = setup(true);
  try {
    expect(root.querySelector(".fjg-overview-search")?.value).toBe("Long");
    root.querySelector(".fjg-overview-title")?.handlers.click();
    expect(root.scrollTop).toBe(0);
    expect(root.querySelector(".test-dashboard-header")).toBeUndefined();
    expect(root.querySelector(".fjg-overview-board")).toBeUndefined();
    const panel = root.querySelector(".fjg-overview-mobile-details")!;
    expect(panel).toBeDefined();
    expect(panel.findText("Back to Overview")?.focused).toBe(true);
    expect(panel.findText("Start Here")).toBeUndefined();
    expect(panel.findText("Folder browser")).toBeUndefined();
    expect(panel.querySelector(".fjg-workspace-path")).toBeUndefined();
    expect(panel.findText("First step · Ongoing")).toBeDefined();
    panel.findText("Show in Files")?.handlers.click();
    panel.findText("Copy path")?.handlers.click();
    panel.findText("Update")?.handlers.click();
    panel.findText("Add action")?.handlers.click();
    expect(panel.findText("Evidence.pdf")).toBeUndefined();
    panel.findText("Chat with this objective")?.handlers.click();
    expect(plugin.openObjectiveChat).toHaveBeenCalledWith("goal-1", "Vault/Objective/task.md");
    panel.findText("Review Files")?.handlers.click();
    panel.findText("View Review")?.handlers.click();
    expect(plugin.openObjectiveFileReview).toHaveBeenNthCalledWith(1, "goal-1", "Vault/Objective/task.md", "review");
    expect(plugin.openObjectiveFileReview).toHaveBeenNthCalledWith(2, "goal-1", "Vault/Objective/task.md", "view");
    panel.findText("Files · 1")?.handlers.click();
    panel.findText("Evidence.pdf")?.handlers.click();
    expect(plugin.showTaskFileLocationInFileFocus).toHaveBeenCalledWith("goal-1");
    expect(plugin.copyTaskFolderPath).toHaveBeenCalledWith("goal-1");
    expect(plugin.openUpdateModal).toHaveBeenCalledWith("goal-1");
    expect(plugin.openObjectiveActionModal).toHaveBeenCalledWith("goal-1", expect.any(Function));
    expect(openFile).toHaveBeenCalledWith(file);
    const check = panel.querySelector(".fjg-workspace-action")?.children[0];
    expect(check?.tag).toBe("input");
    check!.checked = true;
    await check?.handlers.change();
    expect(plugin.workspaceService.updateSubtask).toHaveBeenCalledWith("goal-1", "step-id", { status: "completed" });
    panel.findText("Back to Overview")?.handlers.click();
    expect(root.scrollTop).toBe(128);
    expect(root.querySelector(".fjg-overview-search")?.value).toBe("Long");
    expect(root.querySelector(".fjg-overview-title")?.focused).toBe(true);
    root.querySelector(".fjg-overview-title")?.handlers.click();
    expect(root.querySelector(".fjg-overview-mobile-details")).toBeDefined();
  } finally { vi.unstubAllGlobals(); }
});

it("preserves the desktop split panel and original workspace tabs", () => {
  const { root } = setup(false);
  try {
    root.querySelector(".fjg-overview-title")?.handlers.click();
    expect(root.querySelector(".fjg-overview-mobile-details")).toBeUndefined();
    expect(root.querySelector(".fjg-overview-board")).toBeDefined();
    const panel = root.querySelector(".fjg-overview-details");
    expect(panel?.findText("Start Here")).toBeDefined();
    expect(panel?.findText("Folder browser")).toBeDefined();
    expect(panel?.findText("Close")).toBeDefined();
  } finally { vi.unstubAllGlobals(); }
});
