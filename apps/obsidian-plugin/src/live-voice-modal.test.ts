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
const complete = (output: unknown[]) => ({ status: 200, json: { status: "completed", output } });
const find = { type: "function_call", name: "find_tasks", call_id: "find", arguments: JSON.stringify({ query: "budget", status: "", offset: 0 }) };
const answer = { type: "message", role: "assistant", content: [{ type: "output_text", text: "Your budget review is open." }] };
describe("API objective text search panel", () => {
  it("opens without API requests and submits advanced search with clickable sources, without voice", async () => {
    api.request.mockReset(); api.request.mockResolvedValueOnce(complete([find])).mockResolvedValueOnce(complete([answer]));
    const { root, input, submit, plugin } = setup();
    const toggle = root.all().find(el => el.text === "Text search")!; toggle.handlers.get("click")!();
    expect(toggle.attributes["aria-expanded"]).toBe("true"); expect(input.focus).toHaveBeenCalled(); expect(api.request).not.toHaveBeenCalled();
    expect(root.all().some(el => el.text.includes("API charges apply"))).toBe(true);
    input.value = "What budget work remains?"; await submit();
    expect(api.request).toHaveBeenCalledTimes(2); expect(plugin.resolveOpenAiApiKey).toHaveBeenCalledOnce();
    expect(root.all().some(el => el.text === "Your budget review is open.")).toBe(true);
    root.all().find(el => el.text === "Budget review")!.handlers.get("click")!(); await Promise.resolve();
    expect(plugin.openTask).toHaveBeenCalledWith("a"); expect(DashboardLiveSession).not.toHaveBeenCalled();
  });
  it("handles blank, busy, cancellation and stale results without requesting a microphone", async () => {
    api.request.mockReset();
    const { modal, root, input, submit, plugin, released } = setup();
    await submit(); expect(plugin.resolveOpenAiApiKey).not.toHaveBeenCalled();
    let done!: (value: unknown) => void;
    api.request.mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
    input.value = "Budget?"; const pending = submit(); await Promise.resolve(); await Promise.resolve();
    await submit(); expect(api.request).toHaveBeenCalledTimes(1);
    root.all().find(el => el.text === "Cancel search")!.handlers.get("click")!();
    done(complete([find])); await pending;
    expect(plugin.workspaceService.refresh).not.toHaveBeenCalled();
    expect(root.all().find(el => el.text === "Ask AI")?.disabled).toBe(false);
    modal.onClose(); expect(released).toHaveBeenCalledOnce();
  });
  it("shows API errors and clears history only on explicit new conversation", async () => {
    api.request.mockReset(); api.request.mockResolvedValueOnce({ status: 401 });
    const { root, input, submit } = setup(); input.value = "Budget?"; await submit();
    expect(root.all().some(el => el.text.includes("Check your saved OpenAI API key"))).toBe(true);
    root.all().find(el => el.text === "New search conversation")!.handlers.get("click")!();
    expect(root.all().some(el => el.text.startsWith("New conversation"))).toBe(true);
  });
  it("shares ranked retrieval across notes, updates, actions and archived objectives", () => {
    const tasks = [task("n", "Other", { notes: "budget" }), task("t", "Budget"), task("u", "Update", { updates: [{ text: "budget" }] }), task("r", "Archive", { archived: true, notes: "budget" }), task("s", "Action", { record: { ...task("s", "Action").record, subtasks: [{ title: "budget", notes: "", history: "" }] } })];
    const result = findIndexedTasks(tasks as never, "budget");
    expect(result.total).toBe(5); expect(result.tasks[0].task_id).toBe("t"); expect(result.coverage).toContain("attachment contents are not searched");
  });
});
