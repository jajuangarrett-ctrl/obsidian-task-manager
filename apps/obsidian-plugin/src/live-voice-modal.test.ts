import { describe, expect, it, vi } from "vitest";

class Element {
  children: Element[] = [];
  value = ""; text = ""; hidden = false; disabled = false;
  attributes: Record<string, string> = {}; dataset = {};
  handlers = new Map<string, (event?: any) => unknown>();
  focus = vi.fn();
  constructor(public tag = "div") {}
  createEl(tag: string, options: any = {}) { const child = new Element(tag); child.text = options.text || ""; child.attributes = options.attr || {}; this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  addClass() {}
  empty() { this.children = []; }
  setText(text: string) { this.text = text; }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  addEventListener(name: string, handler: (event?: any) => unknown) { this.handlers.set(name, handler); }
  get lastElementChild() { return this.children.at(-1); }
  querySelector(tag: string) { return this.all().find(el => el.tag === tag); }
  all(): Element[] { return this.children.flatMap(child => [child, ...child.all()]); }
}
vi.mock("obsidian", () => ({ Modal: class {
  contentEl = new Element(); modalEl = new Element(); titleEl = new Element(); close = vi.fn();
} }));
vi.mock("./live-session", () => ({ DashboardLiveSession: vi.fn() }));
import { LiveVoiceModal } from "./live-voice-modal";
import { DashboardLiveSession } from "./live-session";
import { findIndexedTasks } from "./live-tools";
const task = (id: string, title: string, extra = {}) => ({
  record: { task_id: id, title, project: "Test", status: "do-soon", due: "", updated_at: "", subtasks: [] },
  notes: "", updates: [], taskFile: { stat: { mtime: 1 } }, archived: false, ...extra
});
function setup(tasks = [task("a", "Budget review")]) {
  const plugin = { workspaceService: { refresh: vi.fn(async () => {}), list: vi.fn(() => tasks) }, openTask: vi.fn(async () => {}), resolveOpenAiApiKey: vi.fn() };
  const released = vi.fn();
  const modal = new LiveVoiceModal({} as never, plugin as never, () => "", released);
  modal.onOpen();
  const root = modal.contentEl as unknown as Element;
  const input = root.all().find(el => el.tag === "input")!;
  const submit = () => (modal as any).searchObjectives() as Promise<void>;
  return { modal, root, input, submit, plugin, released };
}
describe("local objective text search", () => {
  it("opens an accessible keyboard form and searches without voice or API credentials", async () => {
    const { root, input, submit, plugin } = setup();
    const toggle = root.all().find(el => el.text === "Text search")!;
    toggle.handlers.get("click")!();
    expect(toggle.attributes["aria-expanded"]).toBe("true"); expect(input.focus).toHaveBeenCalled();
    expect(root.all().find(el => el.tag === "form")?.handlers.has("submit")).toBe(true);
    input.value = "budget"; await submit();
    expect(plugin.workspaceService.list).toHaveBeenCalledWith({ includeArchived: true });
    const open = root.all().find(el => el.text === "Budget review")!;
    open.handlers.get("click")!(); await Promise.resolve();
    expect(plugin.openTask).toHaveBeenCalledWith("a");
    expect(plugin.resolveOpenAiApiKey).not.toHaveBeenCalled(); expect(DashboardLiveSession).not.toHaveBeenCalled();
  });
  it("handles blank, no-match, error and repeated busy submissions", async () => {
    const { root, input, submit, plugin } = setup();
    await submit(); expect(plugin.workspaceService.refresh).not.toHaveBeenCalled();
    input.value = "unknown"; await submit();
    expect(root.all().some(el => el.text.includes("No objectives matched"))).toBe(true);
    plugin.workspaceService.refresh.mockRejectedValueOnce(new Error("unavailable"));
    await submit(); expect(root.all().some(el => el.text.startsWith("Could not search"))).toBe(true);
    let done!: () => void;
    plugin.workspaceService.refresh.mockImplementationOnce(() => new Promise<void>(resolve => { done = resolve; }));
    const pending = submit(); await submit(); expect(plugin.workspaceService.refresh).toHaveBeenCalledTimes(3);
    expect(root.all().find(el => el.text === "Searching…")?.disabled).toBe(true);
    done(); await pending; expect(root.all().find(el => el.text === "Search objectives" && el.tag === "button")?.disabled).toBe(false);
  });
  it("ignores pending results after close and releases the panel", async () => {
    const { modal, root, input, submit, plugin, released } = setup();
    let done!: () => void;
    plugin.workspaceService.refresh.mockImplementationOnce(() => new Promise<void>(resolve => { done = resolve; }));
    input.value = "budget"; const pending = submit(); modal.onClose(); done(); await pending;
    expect(root.all().some(el => el.text === "Budget review")).toBe(false); expect(released).toHaveBeenCalledOnce();
  });
  it("paginates all results and recovers when opening an objective fails", async () => {
    const { root, input, submit, plugin } = setup(Array.from({ length: 35 }, (_, i) => task(`${i}`, `Budget ${i}`)));
    input.value = "budget"; await submit();
    expect(root.all().filter(el => el.attributes["aria-label"]?.startsWith("Open objective:")).length).toBe(30);
    const more = root.all().find(el => el.text === "Show more results")!; more.handlers.get("click")!();
    expect(root.all().filter(el => el.attributes["aria-label"]?.startsWith("Open objective:")).length).toBe(35); expect(more.hidden).toBe(true);
    plugin.openTask.mockRejectedValueOnce(new Error("missing"));
    const open = root.all().find(el => el.text === "Budget 0")!; open.handlers.get("click")!(); await Promise.resolve(); await Promise.resolve();
    expect(open.disabled).toBe(false); expect(root.all().some(el => el.text.startsWith("Could not open"))).toBe(true);
  });
  it("shares ranked retrieval across notes, updates, actions and archived objectives", () => {
    const tasks = [task("n", "Other", { notes: "budget" }), task("t", "Budget"), task("u", "Update", { updates: [{ text: "budget" }] }), task("r", "Archive", { archived: true, notes: "budget" }), task("s", "Action", { record: { ...task("s", "Action").record, subtasks: [{ title: "budget", notes: "", history: "" }] } })];
    const result = findIndexedTasks(tasks as never, "budget");
    expect(result.total).toBe(5); expect(result.tasks[0].task_id).toBe("t"); expect(result.coverage).toContain("attachment contents are not searched");
  });
});
