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
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("obsidian", () => ({ requestUrl: api.request, Modal: class {
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
  const plugin = { workspaceService: { refresh: vi.fn(async () => {}), list: vi.fn(() => tasks) }, openTask: vi.fn(async () => {}), resolveOpenAiApiKey: vi.fn(async () => "test-key"), settings: { liveBackendModel: "backend-test" } };
  const released = vi.fn();
  const modal = new LiveVoiceModal({} as never, plugin as never, () => "", released);
  modal.onOpen();
  const root = modal.contentEl as unknown as Element;
  const input = root.all().find(el => el.tag === "input")!;
  const submit = () => (modal as any).searchObjectives() as Promise<void>;
  return { modal, root, input, submit, plugin, released };
}
describe("typed messages in the shared voice panel", () => {
  it("opens a composer without connecting, then starts text-only on explicit submit", async () => {
    let callbacks: any;
    const session = { active: false, acceptingText: false, textOnly: true, dispose: vi.fn(), end: vi.fn(), sendText: vi.fn(() => true),
      start: vi.fn(async () => { session.active = true; session.acceptingText = true; callbacks.state("connected", "Ready"); }) };
    vi.mocked(DashboardLiveSession).mockImplementation(function (_audio, cb) { callbacks = cb; return session as never; });
    const { root, input, plugin, modal } = setup();
    root.all().find(el => el.text === "Type a message")!.handlers.get("click")!();
    expect(plugin.resolveOpenAiApiKey).not.toHaveBeenCalled();
    expect(root.all().some(el => el.text.includes("paid OpenAI session"))).toBe(true);
    await (modal as any).submitText(); expect(plugin.resolveOpenAiApiKey).not.toHaveBeenCalled();
    input.value = "What should I do next?"; await (modal as any).submitText();
    expect(session.start).toHaveBeenCalledWith("test-key", "backend-test", "", "text");
    expect(session.sendText).toHaveBeenCalledWith("What should I do next?"); expect(input.value).toBe("");
    input.value = "Tell me more"; await (modal as any).submitText();
    expect(session.start).toHaveBeenCalledTimes(1); expect(session.sendText).toHaveBeenLastCalledWith("Tell me more");
    callbacks.busy(true); expect(root.all().find(el => el.text === "Send message")?.disabled).toBe(true);
    modal.onClose(); expect(session.end).toHaveBeenCalled();
  });
  it("retains typed input when connection fails and does not send after close during key lookup", async () => {
    const session = { active: false, dispose: vi.fn(), end: vi.fn(), start: vi.fn(), sendText: vi.fn() };
    vi.mocked(DashboardLiveSession).mockImplementation(function () { return session as never; });
    const { input, plugin, modal } = setup();
    let resolve!: (value: string) => void;
    plugin.resolveOpenAiApiKey.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    input.value = "Budget"; const pending = (modal as any).submitText(); modal.onClose(); resolve("key"); await pending;
    expect(session.start).not.toHaveBeenCalled(); expect(session.sendText).not.toHaveBeenCalled(); expect(input.value).toBe("Budget");
  });
  it("shares retrieval across notes, updates, actions and archived objectives", () => {
    const tasks = [task("n", "Other", { notes: "budget" }), task("t", "Budget"), task("u", "Update", { updates: [{ text: "budget" }] }), task("r", "Archive", { archived: true, notes: "budget" })];
    const result = findIndexedTasks(tasks as never, "budget"); expect(result.total).toBe(4); expect(result.tasks[0].task_id).toBe("t");
  });
});
