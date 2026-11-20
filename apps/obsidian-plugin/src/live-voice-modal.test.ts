import { describe, expect, it, vi } from "vitest";

const ui = vi.hoisted(() => ({ mobile: false, width: 386, deferClose: false }));
class Element {
  children: Element[] = [];
  value = ""; text = ""; hidden = false; disabled = false;
  attributes: Record<string, string> = {}; dataset: Record<string, string> = {};
  classes = new Set<string>();
  classList = { toggle: (name: string, on: boolean) => on ? this.classes.add(name) : this.classes.delete(name), contains: (name: string) => this.classes.has(name) };
  style = { setProperty: vi.fn() };
  handlers = new Map<string, (event?: any) => unknown>();
  focus = vi.fn();
  blur = vi.fn();
  parentElement?: Element;
  get ownerDocument() { return documentFixture; }
  get childElementCount() { return this.children.length; }
  constructor(public tag = "div") {}
  createEl(tag: string, options: any = {}) { const child = new Element(tag); child.text = options.text || ""; child.attributes = options.attr || {}; this.appendChild(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendText(text: string) { this.text += text; }
  appendChild(child: Element) { child.remove(); child.parentElement = this; this.children.push(child); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(item => item !== this); this.parentElement = undefined; }
  addClass(...names: string[]) { names.forEach(name => this.classes.add(name)); }
  empty() { this.children = []; }
  setText(text: string) { this.text = text; }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  addEventListener(name: string, handler: (event?: any) => unknown) { this.handlers.set(name, handler); }
  get lastElementChild() { return this.children.at(-1); }
  querySelector(tag: string) { return this.all().find(el => el.tag === tag); }
  all(): Element[] { return this.children.flatMap(child => [child, ...child.all()]); }
}
const viewport = { height: 655, offsetTop: 0, scale: 1, addEventListener: vi.fn(), removeEventListener: vi.fn() };
const documentFixture = { body: new Element("body"), activeElement: null as Element | null,
  defaultView: { visualViewport: viewport, innerHeight: 655,
    matchMedia: () => ({ matches: ui.width <= 600, addEventListener: vi.fn(), removeEventListener: vi.fn() }) }
};
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("obsidian", () => ({ requestUrl: api.request, Platform: { get isMobile() { return ui.mobile; } }, Modal: class {
  contentEl = new Element(); modalEl = new Element(); containerEl = new Element(); titleEl = new Element();
  open() { (this as any).onOpen(); }
  close() { if (!ui.deferClose) (this as any).onClose(); }
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
  const plugin = { workspaceService: { refresh: vi.fn(async () => {}), list: vi.fn(() => tasks), getById: vi.fn((id: string) => { const found = tasks.find(t => t.record.task_id === id); if (!found) throw new Error("Missing objective"); return found; }) }, openTask: vi.fn(async () => {}), resolveOpenAiApiKey: vi.fn(async () => "test-key"), settings: { liveBackendModel: "backend-test" } };
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
    callbacks.busy(true); expect(root.all().find(el => el.attributes["aria-label"] === "Send message")?.disabled).toBe(true);
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

describe("Talk to Vault mobile note handoff", () => {
  async function connected(width = 386, mobile = true, textOnly = false) {
    ui.mobile = mobile;
    ui.width = width;
    ui.deferClose = false;
    documentFixture.body.empty();
    documentFixture.activeElement = null;
    viewport.height = 655;
    viewport.offsetTop = 0;
    let callbacks: any;
    const session = { active: true, acceptingText: true, textOnly, dispose: vi.fn(), end: vi.fn(), mute: vi.fn(),
      sendText: vi.fn(() => true), start: vi.fn(async () => { callbacks.state("connected", "Ready"); }) };
    vi.mocked(DashboardLiveSession).mockImplementation(function (_audio, cb) { callbacks = cb; return session as never; });
    const result = setup();
    await result.modal.start();
    const execute = (name: string, params: Record<string, unknown>) => callbacks.execute(name, JSON.stringify(params), "request");
    const search = () => execute("find_tasks", { query: "Budget", status: "", offset: 0 });
    const open = () => execute("open_task", { task_id: "a" });
    const uiElement = (name: string) => documentFixture.body.all().find(el => el.text === name);
    return { ...result, execute, search, open, session, uiElement, callbacks };
  }

  it("hands an exact folded-screen voice result to the note without dropping the session, and restores the same chat", async () => {
    const { modal, root, input, plugin, session, uiElement, open, search, callbacks, released } = await connected();
    expect((modal.containerEl as unknown as Element).classes.has("fjg-live-compact")).toBe(true);
    await expect(open()).rejects.toThrow("Search for and confirm");
    expect(plugin.openTask).not.toHaveBeenCalled();
    await search();
    expect(plugin.openTask).not.toHaveBeenCalled();
    input.value = "Draft before opening";
    callbacks.transcript("Assistant", "I found the budget.");
    const audio = root.querySelector("audio");
    await expect(open()).resolves.toMatchObject({ opened: true, task: { task_id: "a" } });
    expect(plugin.openTask).toHaveBeenCalledOnce();
    expect(uiElement("Mic live")).toBeDefined();
    expect(uiElement("Mute")).toBeDefined();
    expect(documentFixture.body.querySelector("audio")).toBe(audio);
    uiElement("Mute")!.handlers.get("click")!();
    expect(session.mute).toHaveBeenCalledWith(true);
    expect(uiElement("Mic muted")).toBeDefined();
    expect(session.end).not.toHaveBeenCalled();
    expect(released).not.toHaveBeenCalled();
    uiElement("Chat")!.handlers.get("click")!();
    expect(uiElement("Chat")).toBeUndefined();
    expect(root.querySelector("audio")).toBe(audio);
    expect(root.all().some(el => el.text === "I found the budget.")).toBe(true);
    expect(input.value).toBe("Draft before opening");
    expect(root.all().find(el => el.text === "Unmute microphone")?.attributes["aria-pressed"]).toBe("true");
    expect(root.all().filter(el => el.text === "Show note")).toHaveLength(1);
    expect(session.start).toHaveBeenCalledOnce();
    root.all().find(el => el.text === "Show note")?.handlers.get("click")!();
    expect(uiElement("Mic muted")).toBeDefined();
    expect(plugin.openTask).toHaveBeenCalledOnce();
    modal.close();
    expect(session.end).toHaveBeenCalledOnce();
    expect(released).toHaveBeenCalledOnce();
  });

  it("holds chat on failed navigation and waits for the native close animation before exposing controls", async () => {
    const { modal, plugin, session, uiElement, search, open, released } = await connected(871);
    expect((modal.containerEl as unknown as Element).classes.has("fjg-live-compact")).toBe(false);
    await search();
    plugin.openTask.mockRejectedValueOnce(new Error("Note unavailable"));
    await expect(open()).rejects.toThrow("Note unavailable");
    expect(uiElement("Chat")).toBeUndefined();
    expect(session.end).not.toHaveBeenCalled();
    ui.deferClose = true;
    await open();
    modal.restore();
    expect(uiElement("Chat")?.parentElement?.hidden).toBe(true);
    modal.onClose();
    expect(uiElement("Chat")?.parentElement?.hidden).toBe(false);
    modal.shutdown();
    expect(uiElement("Chat")).toBeUndefined();
    expect(session.end).toHaveBeenCalledOnce();
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(released).toHaveBeenCalledOnce();
    ui.deferClose = false;
  });

  it("preserves explicit reference-button desktop behavior and never turns on a text-only mic from the note", async () => {
    const desktop = await connected(386, false);
    await desktop.search();
    desktop.root.all().find(el => el.text === "Budget review")!.handlers.get("click")!();
    await Promise.resolve();
    expect(desktop.session.end).toHaveBeenCalledOnce();
    expect(desktop.uiElement("Chat")).toBeUndefined();
    const mobile = await connected(386, true, true);
    await mobile.search();
    mobile.root.all().find(el => el.text === "Budget review")!.handlers.get("click")!();
    await Promise.resolve();
    expect(mobile.uiElement("Mic off")).toBeDefined();
    expect(mobile.uiElement("Mute")?.hidden).toBe(true);
    mobile.uiElement("End")?.handlers.get("click")!();
    expect(mobile.session.mute).not.toHaveBeenCalled();
    expect(mobile.session.end).toHaveBeenCalledOnce();
  });

  it("fits a wide mobile chat above the keyboard and restores its wider layout on dismiss", async () => {
    const { modal, input } = await connected(871);
    const shell = modal.containerEl as unknown as Element;
    const resize = [...viewport.addEventListener.mock.calls].reverse().find(([name]) => name === "resize")?.[1];
    expect(shell.classes.has("fjg-live-mobile")).toBe(true);
    expect(shell.classes.has("fjg-live-compact")).toBe(false);
    documentFixture.activeElement = input;
    viewport.height = 330; viewport.offsetTop = 28;
    resize();
    expect(shell.classes.has("fjg-live-compact")).toBe(true);
    expect(shell.style.setProperty).toHaveBeenCalledWith("--fjg-live-screen-height", "330px");
    expect(shell.style.setProperty).toHaveBeenCalledWith("--fjg-live-screen-top", "28px");
    documentFixture.activeElement = null;
    viewport.height = 655; viewport.offsetTop = 0;
    resize();
    expect(shell.classes.has("fjg-live-compact")).toBe(false);
    modal.close();
  });

  it("does not create a note bar after late navigation resolves on a closed conversation", async () => {
    const { modal, plugin, search, open, uiElement } = await connected();
    await search();
    let resolve!: () => void;
    plugin.openTask.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
    const pending = open();
    const checked = expect(pending).rejects.toThrow("Conversation ended");
    await Promise.resolve();
    modal.close();
    resolve();
    await checked;
    expect(uiElement("Chat")).toBeUndefined();
    expect(viewport.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
