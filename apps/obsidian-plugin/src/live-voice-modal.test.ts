import { describe, expect, it, vi } from "vitest";

const ui = vi.hoisted(() => ({ mobile: false, width: 386, deferClose: false, modalOpens: 0, foreignChat: false }));
class Element {
  children: Element[] = [];
  value = ""; text = ""; hidden = false; disabled = false;
  attributes: Record<string, string> = {}; dataset: Record<string, string> = {};
  classes = new Set<string>();
  classList = { add: (value: string) => this.classes.add(value), remove: (value: string) => this.classes.delete(value), toggle: (name: string, on: boolean) => on ? this.classes.add(name) : this.classes.delete(name), contains: (name: string) => this.classes.has(name) };
  properties = new Map<string, string>();
  style = { setProperty: vi.fn((key: string, value: string) => this.properties.set(key, value)),
    getPropertyValue: (key: string) => this.properties.get(key) ?? "", removeProperty: (key: string) => this.properties.delete(key) };
  isConnected = true;
  layout?: { left: number; width: number };
  getClientRects() { return this.hidden ? [] : [this.getBoundingClientRect()]; }
  getBoundingClientRect() {
    const { left, width } = this.layout ?? { left: 0, width: ui.width };
    return { left, right: left + width, top: 0, bottom: 655, width, height: 655 };
  }
  contains(el: Element | null) { return el === this || (el !== null && this.all().includes(el)); }
  handlers = new Map<string, (event?: any) => unknown>();
  focus = vi.fn();
  blur = vi.fn();
  parentElement?: Element;
  documentOverride?: object;
  get ownerDocument() { return (this.documentOverride ?? documentFixture) as typeof documentFixture; }
  get childElementCount() { return this.children.length; }
  constructor(public tag = "div") {}
  createEl(tag: string, options: any = {}) { const child = new Element(tag); child.text = options.text || ""; if (options.cls) child.addClass(...options.cls.split(" ")); child.attributes = options.attr || {}; this.appendChild(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendText(text: string) { this.text += text; }
  appendChild(child: Element) { child.remove(); child.parentElement = this; this.children.push(child); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(item => item !== this); this.parentElement = undefined; }
  addClass(...names: string[]) { names.forEach(name => this.classes.add(name)); }
  empty() { [...this.children].forEach(child => child.remove()); }
  setText(text: string) { this.text = text; }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  addEventListener(name: string, handler: (event?: any) => unknown) { this.handlers.set(name, handler); }
  get lastElementChild() { return this.children.at(-1); }
  querySelector(selector: string) {
    if (selector.startsWith(":scope > .")) return this.children.find(el => el.classes.has(selector.slice(10)));
    if (selector.startsWith(".")) return this.all().find(el => selector.slice(1).split(".").every(cls => el.classes.has(cls)));
    return this.all().find(el => el.tag === selector);
  }
  all(): Element[] { return this.children.flatMap(child => [child, ...child.all()]); }
}
const viewport = { height: 655, get width() { return ui.width; }, offsetLeft: 0, offsetTop: 0, scale: 1, addEventListener: vi.fn(), removeEventListener: vi.fn() };
const frameCallbacks = new Map<number, () => void>();
let frameId = 0;
const documentFixture = { body: new Element("body"), querySelector: (_selector: string) => undefined, activeElement: null as Element | null,
  defaultView: { visualViewport: viewport, innerHeight: 655, get innerWidth() { return ui.width; }, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    requestAnimationFrame: (fn: () => void) => { frameCallbacks.set(++frameId, fn); return frameId; }, cancelAnimationFrame: (id: number) => frameCallbacks.delete(id),
    matchMedia: (query: string) => ({ matches: query.includes("min-width") ? ui.width >= 760 : ui.width <= 600, addEventListener: vi.fn(), removeEventListener: vi.fn() }) }
};
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("obsidian", () => ({ requestUrl: api.request, ItemView: class { contentEl = new Element(); }, Platform: { get isMobile() { return ui.mobile; } }, Modal: class {
  constructor(public app: unknown) {}

  contentEl = new Element(); modalEl = new Element(); containerEl = new Element(); titleEl = new Element();
  open() { ui.modalOpens++; (this as any).onOpen(); }
  close() { if (!ui.deferClose) (this as any).onClose(); }
} }));
vi.mock("./live-session", () => ({ DashboardLiveSession: vi.fn() }));
import { LiveVoiceModal } from "./live-voice-modal";
import { LiveConversationView, LIVE_CONVERSATION_VIEW } from "./live-conversation-view";
import { DashboardLiveSession } from "./live-session";
import { findIndexedTasks } from "./live-tools";
const task = (id: string, title: string, extra = {}) => ({
  record: { task_id: id, title, project: "Test", status: "do-soon", due: "", updated_at: "", subtasks: [] },
  notes: "", updates: [], taskFile: { path: id + "/Task.md", stat: { mtime: 1 } }, archived: false, ...extra
});
class Leaf {
  view: { getViewType: () => string; getState?: () => { file: string }; file?: unknown; containerEl?: Element } | LiveConversationView = { getViewType: () => "empty" };
  setViewState = vi.fn(async (_state: unknown) => {
    const view = new LiveConversationView(this as never);
    if (ui.foreignChat) (view.contentEl as unknown as Element).documentOverride = {};
    this.view = view;
    await view.onOpen();
  });
  openFile = vi.fn(async (file: unknown, _options?: unknown) => { this.view = { getViewType: () => "markdown", getState: () => ({ file: (file as { path: string }).path }), file }; });
  detached = false;
  detach = vi.fn(() => { this.detached = true; if (this.view instanceof LiveConversationView) void this.view.onClose(); });
}
function setup(tasks = [task("a", "Budget review")], laneHost = false,
  options: { peer?: "markdown" | "dashboard"; hidden?: boolean; drawer?: number; occupied?: boolean; setupChat?: () => Promise<void> } = {}) {
  const plugin = { workspaceService: { refresh: vi.fn(async () => {}), list: vi.fn(() => tasks), getById: vi.fn((id: string) => { const found = tasks.find(t => t.record.task_id === id); if (!found) throw new Error("Missing objective"); return found; }) }, openTask: vi.fn(async () => {}), resolveOpenAiApiKey: vi.fn(async () => "test-key"), settings: { liveBackendModel: "backend-test" } };
  const released = vi.fn();
  const leaves: Leaf[] = [];
  const nextOpen = vi.fn<(file: unknown, options?: unknown) => Promise<void>>();
  const allocate = () => {
    const leaf = new Leaf(); leaves.push(leaf);
    const state = leaf.setViewState.getMockImplementation()!;
    leaf.setViewState.mockImplementation(async (...args) => { await options.setupChat?.(); await state(...args); });
    const open = leaf.openFile.getMockImplementation()!;
    leaf.openFile.mockImplementation(async (...args) => { await nextOpen(...args); await open(...args); });
    return leaf;
  };
  const containerEl = new Element();
  const nativeRoot = laneHost ? containerEl.createDiv({ cls: "workspace-split mod-root" }) : undefined;
  if (nativeRoot) nativeRoot.style.setProperty("--foreign-layout", "untouched");
  if (nativeRoot && options.drawer) nativeRoot.layout = { left: 0, width: options.drawer };
  if (nativeRoot && options.occupied) nativeRoot.createDiv({ cls: "fjgduo-vault-live-split-pane" });
  let active: Leaf | undefined;
  let peer: Leaf | undefined;
  if (options.peer && nativeRoot) {
    peer = active = new Leaf(); leaves.push(peer);
    const containerEl = nativeRoot.createDiv(); containerEl.hidden = !!options.hidden;
    peer.view = options.peer === "markdown"
      ? { getViewType: () => "markdown", getState: () => ({ file: "Unrelated open note.md" }), containerEl }
      : { getViewType: () => "fjg-task-manager-dashboard", containerEl };
  }
  const workspace = { containerEl, getLeaf: vi.fn((_kind: string) => allocate()),
    getMostRecentLeaf: vi.fn(() => active),
    iterateAllLeaves: (callback: (leaf: Leaf) => void) => leaves.filter(leaf => !leaf.detached).forEach(callback),
    getLeavesOfType: vi.fn((type: string) => leaves.filter(leaf => !leaf.detached && leaf.view.getViewType() === type)),
    createLeafBySplit: vi.fn((_leaf: Leaf, _direction: string, _before: boolean) => allocate()),
    revealLeaf: vi.fn(async (leaf: Leaf) => { active = leaf; }) };
  const modal = new LiveVoiceModal({ workspace } as never, plugin as never, () => "", released);
  modal.open();
  const root = modal.contentEl as unknown as Element;
  const input = root.all().find(el => el.tag === "input")!;
  return { modal, root, input, plugin, released, workspace, leaves, nextOpen, nativeRoot, peer, setActive: (leaf?: Leaf) => { active = leaf; } };
}
describe("typed messages in the shared voice panel", () => {
  it("opens a composer without connecting, then starts text-only on explicit submit", async () => {
    let callbacks: any;
    const session = { active: false, acceptingText: false, textOnly: true, prepareTextInput: vi.fn(), dispose: vi.fn(), end: vi.fn(), sendText: vi.fn(() => true),
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
    const session = { active: false, prepareTextInput: vi.fn(), dispose: vi.fn(), end: vi.fn(), start: vi.fn(), sendText: vi.fn() };
    vi.mocked(DashboardLiveSession).mockImplementation(function () { return session as never; });
    const { input, plugin, modal } = setup();
    let resolve!: (value: string) => void;
    plugin.resolveOpenAiApiKey.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    input.value = "Budget"; const pending = (modal as any).submitText(); modal.onClose(); resolve("key"); await pending;
    expect(session.start).not.toHaveBeenCalled(); expect(session.sendText).not.toHaveBeenCalled(); expect(input.value).toBe("Budget");
  });
  it("keeps the active send failure and draft instead of replacing the error with a busy hint", async () => {
    let callbacks: any;
    const session = { active: true, acceptingText: true, textOnly: true, prepareTextInput: vi.fn(),
      dispose: vi.fn(), end: vi.fn(), start: vi.fn(async () => callbacks.state("connected", "Ready")),
      sendText: vi.fn(() => {
        session.active = false;
        callbacks.state("error", "Could not send the message. Your draft was kept. Reconnect before trying again.");
        return false;
      }) };
    vi.mocked(DashboardLiveSession).mockImplementation(function (_audio, cb) { callbacks = cb; return session as never; });
    const { modal, input, root } = setup();
    await modal.start("text");
    input.value = "Confirm the synthetic objective change";
    await (modal as any).submitText();
    expect(session.sendText).toHaveBeenCalledExactlyOnceWith(input.value);
    expect(input.value).toBe("Confirm the synthetic objective change");
    expect(root.all().some(el => el.text.includes("Your draft was kept"))).toBe(true);
    expect(root.all().some(el => el.text.includes("Wait for the current request"))).toBe(false);
    modal.close();
  });
  it("shares retrieval across notes, updates, actions and archived objectives", () => {
    const tasks = [task("n", "Other", { notes: "budget" }), task("t", "Budget"), task("u", "Update", { updates: [{ text: "budget" }] }), task("r", "Archive", { archived: true, notes: "budget" })];
    const result = findIndexedTasks(tasks as never, "budget"); expect(result.total).toBe(4); expect(result.tasks[0].task_id).toBe("t");
  });
});

describe("wide mobile Talk to Vault launch", () => {
  const reset = (width = 840) => {
    Object.assign(ui, { width, mobile: true, deferClose: false, foreignChat: false, modalOpens: 0 });
    documentFixture.body.empty(); documentFixture.activeElement = null;
    frameCallbacks.clear();
  };
  const measure = () => {
    viewport.addEventListener.mock.calls.filter(([name]) => name === "resize").at(-1)?.[1]();
    for (const [id, fn] of [...frameCallbacks]) { frameCallbacks.delete(id); fn(); }
  };

  it("docks immediately beside the same visible Markdown leaf, without navigation or a session", async () => {
    reset();
    const { modal, root, input, plugin, leaves, nativeRoot, workspace, peer } = setup(undefined, true, { peer: "markdown" });
    const audio = root.querySelector("audio"), openView = peer!.view;
    await vi.waitFor(() => expect(root.parentElement?.classes.has("fjg-live-lane")).toBe(true));
    expect(leaves).toHaveLength(2);
    expect(peer!.view).toBe(openView);
    expect(peer!.openFile).not.toHaveBeenCalled();
    expect(workspace.revealLeaf).not.toHaveBeenCalled();
    expect(plugin.resolveOpenAiApiKey).not.toHaveBeenCalled();
    expect(root.querySelector("audio")).toBe(audio);
    input.value = "Draft across widths";
    ui.width = 390; measure();
    expect(nativeRoot!.querySelector(".fjg-live-lane")).toBeUndefined();
    documentFixture.body.all().find(el => el.text === "Chat")!.handlers.get("click")!();
    expect(workspace.revealLeaf).toHaveBeenLastCalledWith(leaves[1]);
    ui.width = 840; measure();
    expect(workspace.revealLeaf).toHaveBeenLastCalledWith(peer);
    expect(root.querySelector("audio")).toBe(audio);
    expect(input.value).toBe("Draft across widths");
    modal.close();
    expect(peer!.detach).not.toHaveBeenCalled();
    expect(leaves[1].detach).toHaveBeenCalledOnce();
  });

  it("uses only the usable root width and docks after the drawer's own layout becomes wide", async () => {
    reset();
    const { modal, workspace, nativeRoot, root } = setup(undefined, true, { peer: "dashboard", drawer: 640 });
    expect(workspace.getLeaf).not.toHaveBeenCalled();
    nativeRoot!.layout = { left: -200, width: 840 }; measure();
    expect(workspace.getLeaf).not.toHaveBeenCalled(); // layout width alone is not enough
    nativeRoot!.layout = { left: -42, width: 840 }; measure();
    await vi.waitFor(() => expect(root.parentElement?.classes.has("fjg-live-lane")).toBe(true));
    expect(root.all().find(el => el.text === "Show dashboard")?.hidden).toBe(false);
    expect(nativeRoot!.style.getPropertyValue("--fjg-live-lane-left")).toBe("42px");
    modal.close();
  });

  it.each([{ hidden: true }, { occupied: true }])("does not adopt a hidden note or compete with a Duo lane (%j)", options => {
    reset();
    const { modal, root, workspace } = setup(undefined, true, { peer: "markdown", ...options });
    expect(workspace.getLeaf).not.toHaveBeenCalled();
    expect(root.parentElement?.classes.has("fjg-live-lane")).not.toBe(true);
    modal.close();
  });

  it("does not move a stale chat after the notes change during async launch", async () => {
    reset();
    let resume!: () => void;
    const { modal, root, leaves, peer, workspace } = setup(undefined, true, { peer: "markdown", setupChat: () => new Promise(r => { resume = r; }) });
    expect(leaves).toHaveLength(2);
    peer!.view = { getViewType: () => "markdown", getState: () => ({ file: "Switched.md" }) };
    resume();
    await vi.waitFor(() => expect(leaves[1].detach).toHaveBeenCalledOnce());
    expect(peer!.detach).not.toHaveBeenCalled();
    expect(workspace.revealLeaf).not.toHaveBeenCalled();
    expect(root.parentElement?.classes.has("fjg-live-lane")).not.toBe(true);
    modal.close();
  });

  it("does not dock or reopen when closed during native chat initialization", async () => {
    reset();
    let resume!: () => void;
    const { modal, nativeRoot, released, leaves, peer } = setup(undefined, true, { peer: "markdown", setupChat: () => new Promise(r => { resume = r; }) });
    modal.close(); resume();
    await vi.waitFor(() => expect(leaves[1].detach).toHaveBeenCalledOnce());
    expect(nativeRoot!.querySelector(".fjg-live-lane")).toBeUndefined();
    expect(peer!.detach).not.toHaveBeenCalled();
    expect(released).toHaveBeenCalledOnce();
  });
});

describe("Talk to Vault native note handoff", () => {
  async function connected(width = 386, textOnly = false, mobile = width < 760, laneHost = false) {
    const tasks = [task("a", "Budget review"), task("b", "Travel review")];
    Object.assign(ui, { mobile, width, deferClose: false, modalOpens: 0, foreignChat: false });
    documentFixture.body.empty();
    documentFixture.activeElement = null;
    viewport.height = 655; viewport.offsetTop = 0;
    let callbacks: any;
    const session = { active: true, acceptingText: true, textOnly, prepareTextInput: vi.fn(),
      dispose: vi.fn(), end: vi.fn(), mute: vi.fn(), enableMicrophone: vi.fn(), sendText: vi.fn(() => true),
      start: vi.fn(async () => { callbacks.state("connected", "Ready"); }) };
    vi.mocked(DashboardLiveSession).mockImplementation(function (_audio, cb) { callbacks = cb; return session as never; });
    const result = setup(tasks, laneHost);
    await result.modal.start(textOnly ? "text" : "voice");
    let request = 0;
    const execute = (name: string, params: Record<string, unknown>) => callbacks.execute(name, JSON.stringify(params), "request-" + ++request);
    const search = () => execute("find_tasks", { query: "Budget", status: "", offset: 0 });
    const read = (id: string) => execute("read_task", { task_id: id });
    const open = (id = "a") => execute("open_task", { task_id: id });
    const barItem = (name: string) => documentFixture.body.all().find(el => el.text === name);
    return { ...result, tasks, execute, search, read, open, session, barItem, callbacks };
  }

  it("docks the exact chat, draft and media into a wide native left pane and reuses the right Markdown leaf", async () => {
    const { root, input, plugin, session, open, read, search, callbacks, released, leaves, workspace, tasks, modal } = await connected(1024, false, false);
    const unrelated = new Leaf();
    unrelated.view = { getViewType: () => "markdown", file: { path: "Unrelated.md" } };
    await expect(open()).rejects.toThrow("Search for and confirm");
    expect(workspace.getLeaf).not.toHaveBeenCalled();
    await search();
    input.value = "Draft before opening";
    callbacks.transcript("Assistant", "I found the budget.");
    const audio = root.querySelector("audio");
    await expect(open()).resolves.toMatchObject({ opened: true, task: { task_id: "a" } });
    const [chat, note] = leaves;
    expect(chat.setViewState).toHaveBeenCalledWith({ type: LIVE_CONVERSATION_VIEW, active: false });
    expect(workspace.createLeafBySplit).toHaveBeenCalledWith(chat, "vertical", false);
    expect(note.openFile).toHaveBeenCalledWith(tasks[0].taskFile, { active: true, state: { mode: "preview" } });
    expect((chat.view as LiveConversationView).contentEl).toBe(root.parentElement);
    expect(root.querySelector("audio")).toBe(audio);
    expect(root.all().some(el => el.text === "I found the budget.")).toBe(true);
    expect(input.value).toBe("Draft before opening");
    await read("b");
    await open("b");
    expect(leaves).toHaveLength(2);
    expect(note.openFile).toHaveBeenLastCalledWith(tasks[1].taskFile, expect.any(Object));
    expect(unrelated.openFile).not.toHaveBeenCalled();
    expect(unrelated.detach).not.toHaveBeenCalled();
    expect(plugin.openTask).not.toHaveBeenCalled();
    expect(session.start).toHaveBeenCalledOnce();
    expect(session.end).not.toHaveBeenCalled();
    const chatView = chat.view as LiveConversationView;
    chat.view = { getViewType: () => "markdown", file: { path: "New user-selected note.md" } };
    await chatView.onClose();
    modal.close();
    expect(chat.detach).not.toHaveBeenCalled();
    expect(chat.view.getViewType()).toBe("markdown");
    expect(session.end).toHaveBeenCalledOnce();
    expect(released).toHaveBeenCalledOnce();
    expect(note.detach).not.toHaveBeenCalled();
  });

  it("switches between compact native tabs without reopening chat or enabling a text-only microphone", async () => {
    const { root, input, read, nextOpen, barItem, leaves, workspace, modal, session } = await connected(386, true);
    const audio = root.querySelector("audio");
    input.value = "Unsent follow-up";
    await read("a");
    root.all().find(el => el.attributes["aria-label"] === "Open objective: Budget review")!.handlers.get("click")!();
    await vi.waitFor(() => expect(barItem("Chat")).toBeDefined());
    expect(nextOpen).toHaveBeenCalledOnce();
    expect(workspace.createLeafBySplit).not.toHaveBeenCalled();
    expect(workspace.getLeaf).toHaveBeenCalledTimes(2);
    expect(barItem("Mic off")).toBeDefined();
    expect(barItem("Mute")?.hidden).toBe(true);
    for (let i = 0; i < 2; i++) {
      barItem("Chat")!.handlers.get("click")!();
      expect(workspace.revealLeaf).toHaveBeenLastCalledWith(leaves[0]);
      barItem("Note")!.handlers.get("click")!();
      expect(workspace.revealLeaf).toHaveBeenLastCalledWith(leaves[1]);
    }
    expect(ui.modalOpens).toBe(1);
    expect(root.querySelector("audio")).toBe(audio);
    expect(input.value).toBe("Unsent follow-up");
    expect(session.enableMicrophone).not.toHaveBeenCalled();
    expect(session.start).toHaveBeenCalledOnce();
    modal.shutdown();
    expect(leaves[0].detach).toHaveBeenCalledOnce();
    expect(leaves[1].detach).not.toHaveBeenCalled();
    expect(session.end).toHaveBeenCalledOnce();
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(barItem("Chat")).toBeUndefined();
  });

  it("falls back to native Chat/Note tabs at wide mobile widths without an owned workspace host", async () => {
    const { search, open, barItem, workspace, leaves, modal } = await connected(840, false, true);
    await search(); await open();
    expect(workspace.createLeafBySplit).not.toHaveBeenCalled();
    expect(workspace.getLeaf).toHaveBeenCalledTimes(2);
    barItem("Chat")!.handlers.get("click")!();
    expect(workspace.revealLeaf).toHaveBeenLastCalledWith(leaves[0]);
    modal.close();
  });

  it("reserves a wide mobile lane, follows keyboard height without switching layouts and restores on expand", async () => {
    const { search, open, barItem, workspace, leaves, nativeRoot, root, input, modal, session } = await connected(840, false, true, true);
    const host = nativeRoot!;
    const audio = root.querySelector("audio");
    input.value = "Keep this draft";
    await search(); await open();
    expect(workspace.createLeafBySplit).not.toHaveBeenCalled();
    expect(host.classes.has("fjg-live-lane-root")).toBe(true);
    expect(root.parentElement?.classes.has("fjg-live-lane")).toBe(true);
    expect(host.style.getPropertyValue("--fjg-live-lane-pane-width")).toBe("353px");
    const resize = viewport.addEventListener.mock.calls.filter(([name]) => name === "resize").at(-1)?.[1];
    const update = () => { resize(); for (const [id, task] of frameCallbacks) { frameCallbacks.delete(id); task(); } };
    viewport.height = 330; documentFixture.activeElement = input; update();
    expect(host.classes.has("fjg-live-lane-keyboard")).toBe(true);
    expect(host.style.getPropertyValue("--fjg-live-lane-height")).toBe("330px");
    expect(root.parentElement?.classes.has("fjg-live-lane")).toBe(true);
    expect(workspace.revealLeaf).toHaveBeenLastCalledWith(leaves[1]);
    ui.width = 700; update();
    expect(host.classes.has("fjg-live-lane-root")).toBe(true); // exit hysteresis
    ui.width = 660; update();
    expect(host.classes.has("fjg-live-lane-root")).toBe(false);
    expect(root.parentElement).toBe((leaves[0].view as LiveConversationView).contentEl);
    expect(workspace.revealLeaf).toHaveBeenLastCalledWith(leaves[0]); // preserve focused composer
    viewport.height = 655; ui.width = 840; documentFixture.activeElement = null; update();
    expect(host.classes.has("fjg-live-lane-root")).toBe(true);
    expect(root.querySelector("audio")).toBe(audio);
    expect(input.value).toBe("Keep this draft");
    barItem("Note")!.handlers.get("click")!();
    expect(host.classes.has("fjg-live-lane-root")).toBe(false);
    update();
    expect(host.classes.has("fjg-live-lane-root")).toBe(false);
    barItem("Chat")!.handlers.get("click")!();
    expect(host.classes.has("fjg-live-lane-root")).toBe(true);
    modal.close();
    expect(session.end).toHaveBeenCalledOnce();
    expect(host.querySelector(".fjg-live-lane")).toBeUndefined();
    expect([...host.properties.keys()]).toEqual(["--foreign-layout"]);
    expect(host.classes).toEqual(new Set(["workspace-split", "mod-root"]));
    expect(viewport.removeEventListener).toHaveBeenCalledWith("resize", resize);
  });

  it("does not let the delayed native modal close callback terminate transferred chat", async () => {
    const { modal, search, open, session, barItem } = await connected();
    ui.deferClose = true;
    await search(); await open();
    modal.onClose();
    expect(session.end).not.toHaveBeenCalled();
    barItem("Mute")!.handlers.get("click")!();
    expect(session.mute).toHaveBeenCalledWith(true);
    expect(barItem("Mic muted")).toBeDefined();
    modal.close();
    expect(session.end).toHaveBeenCalledOnce();
  });

  it("detaches only newly allocated leaves when the conversation closes during openFile", async () => {
    const { modal, search, open, released, barItem, workspace, leaves, nextOpen, session } = await connected();
    await search();
    let resume!: () => void;
    nextOpen.mockImplementationOnce(() => new Promise<void>(resolve => { resume = resolve; }));
    const pending = open();
    const settled = pending.catch(() => undefined);
    await vi.waitFor(() => expect(nextOpen).toHaveBeenCalledOnce());
    modal.close(); resume(); await settled;
    expect(workspace.revealLeaf).not.toHaveBeenCalled();
    expect(leaves).toHaveLength(2);
    for (const leaf of leaves) expect(leaf.detach).toHaveBeenCalledOnce();
    expect(barItem("Chat")).toBeUndefined();
    expect(session.end).toHaveBeenCalledOnce();
    expect(released).toHaveBeenCalledOnce();
  });

  it("does not reinstall a mobile lane or detach chat twice if closed while native reveal is pending", async () => {
    const { modal, search, open, workspace, leaves, nativeRoot, session, released, barItem } = await connected(840, false, true, true);
    await search();
    let resume!: () => void;
    workspace.revealLeaf.mockImplementationOnce(() => new Promise<void>(resolve => { resume = resolve; }));
    const pending = open();
    const cancelled = expect(pending).rejects.toThrow("Objective opening was cancelled");
    await vi.waitFor(() => expect(workspace.revealLeaf).toHaveBeenCalledOnce());
    expect(barItem("Chat")).toBeDefined();
    const viewportListenerCount = viewport.addEventListener.mock.calls.length;
    const windowListenerCount = documentFixture.defaultView.addEventListener.mock.calls.length;
    modal.close();
    resume(); await cancelled;
    expect(leaves[0].detach).toHaveBeenCalledOnce();
    expect(leaves[1].detach).not.toHaveBeenCalled();
    expect(session.end).toHaveBeenCalledOnce();
    expect(released).toHaveBeenCalledOnce();
    expect(barItem("Chat")).toBeUndefined();
    expect(viewport.addEventListener).toHaveBeenCalledTimes(viewportListenerCount);
    expect(documentFixture.defaultView.addEventListener).toHaveBeenCalledTimes(windowListenerCount);
    expect(nativeRoot!.querySelector(".fjg-live-lane")).toBeUndefined();
    expect([...nativeRoot!.properties.keys()]).toEqual(["--foreign-layout"]);
  });

  it("rejects a different native window before opening the note or moving the chat", async () => {
    const { root, search, open, leaves, nextOpen, workspace, session, modal } = await connected();
    ui.foreignChat = true;
    const audio = root.querySelector("audio");
    await search();
    await expect(open()).rejects.toThrow(/original window/i);
    expect(nextOpen).not.toHaveBeenCalled();
    expect(workspace.revealLeaf).not.toHaveBeenCalled();
    expect(leaves).toHaveLength(1);
    expect(leaves[0].detach).toHaveBeenCalledOnce();
    expect(root.querySelector("audio")).toBe(audio);
    expect(session.end).not.toHaveBeenCalled();
    modal.close();
  });

  it("recovers to chat after a note closes and does not overwrite a repurposed Markdown leaf", async () => {
    const { search, open, read, barItem, leaves, workspace, session, modal, root } = await connected();
    await search(); await open();
    const [chat, originalNote] = leaves;
    originalNote.view = { getViewType: () => "markdown", getState: () => ({ file: "User-selected.md" }) };
    barItem("Note")!.handlers.get("click")!();
    expect(workspace.revealLeaf).toHaveBeenLastCalledWith(chat);
    expect(root.all().some(el => el.text.includes("note was closed or changed"))).toBe(true);
    await read("b"); await open("b");
    expect(leaves).toHaveLength(3);
    expect(originalNote.openFile).toHaveBeenCalledOnce();
    expect(originalNote.detach).not.toHaveBeenCalled();
    leaves[2].detach();
    barItem("Note")!.handlers.get("click")!();
    expect(workspace.revealLeaf).toHaveBeenLastCalledWith(chat);
    expect(session.end).not.toHaveBeenCalled();
    modal.close();
  });

  it("keeps chat open after a failed native note load and removes both attempted leaves", async () => {
    const { search, open, leaves, nextOpen, session, barItem, modal } = await connected();
    await search();
    nextOpen.mockRejectedValueOnce(new Error("Note unavailable"));
    await expect(open()).rejects.toThrow("Note unavailable");
    expect(leaves).toHaveLength(2);
    for (const leaf of leaves) expect(leaf.detach).toHaveBeenCalledOnce();
    expect(barItem("Chat")).toBeUndefined();
    expect(session.end).not.toHaveBeenCalled();
    modal.close();
  });
});
