import { describe, expect, it, vi } from "vitest";

const pickers = vi.hoisted(() => [] as Array<{ current: string; submit: (path: string) => Promise<void>; purpose: string }>);
vi.mock("obsidian", () => ({ Modal: class {}, Notice: vi.fn(), setIcon: vi.fn() }));
vi.mock("./capture-live/panel", () => ({ CaptureVoice: class {}, inputField: vi.fn() }));
vi.mock("./openai-capture", () => ({ draftTasksFromCapture: vi.fn(), startVoiceRecording: vi.fn(), transcribeTaskAudio: vi.fn() }));
vi.mock("./modals", () => ({ TaskRelocationModal: class {
  constructor(_app: unknown, _title: string, current: string, _destinations: string[], submit: (path: string) => Promise<void>, purpose: string) {
    pickers.push({ current, submit, purpose });
  }
  open() {}
} }));

import { QuickCaptureModal } from "./quick-capture-modal";
import type { TaskCaptureDraft } from "./quick-capture-model";

// Small Obsidian element double; exercises real capture rendering and event callbacks.
class Element {
  children: Element[] = [];
  handlers = new Map<string, () => void>();
  value = "";
  text = "";
  selected = false;
  hidden = false;
  id = "";
  classList = { toggle: vi.fn() };
  constructor(public tag = "div") {}
  createEl(tag: string, options: { text?: string; value?: string } = {}) {
    const child = new Element(tag); child.text = options.text || ""; child.value = options.value || "";
    this.children.push(child); return child;
  }
  createDiv() { return this.createEl("div"); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass() {}
  empty() { this.children = []; }
  setText(value: string) { this.text = value; }
  setAttribute() {}
  addEventListener(name: string, handler: () => void) { this.handlers.set(name, handler); }
  get selectedOptions() { return this.children.filter((element) => element.selected); }
  descendants(): Element[] { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  button(label: string) {
    const result = this.descendants().find((element) => element.tag === "button" && element.children.some((child) => child.text === label));
    if (!result) throw new Error(`Missing button ${label}`);
    return result;
  }
  click() { this.handlers.get("click")?.(); }
}

function capture(destination?: string) {
  const draft: TaskCaptureDraft = { title: "Capture example", details: "Keep details", status: "waiting", project: "Existing project", people: ["Franklin"], due: "2026-11-01", delegatedTo: "", source: { type: "manual", title: "Keep source", url: "" }, destination };
  const plugin = { settings: { inboxRoot: "08 Tasks/Inbox" }, workspaceService: { peopleNames: () => ["Franklin"], listRelocationDestinations: () => ["02 Programs/CalWORKs", "03 Areas/Misc"] } };
  const modal = new QuickCaptureModal({} as never, plugin as never, "", draft) as unknown as {
    drafts: TaskCaptureDraft[]; formsContainer: Element; renderDraftForms: () => void; syncDraftsFromForms: () => void;
  };
  const root = new Element(); modal.formsContainer = root; modal.renderDraftForms();
  return { modal, root };
}

describe("native capture destination controls", () => {
  it("uses the shared picker in capture mode and preserves the configured default when cancelled", () => {
    const { modal, root } = capture();
    expect(root.descendants().some((element) => element.text === "08 Tasks/Inbox")).toBe(true);
    root.button("Choose folder").click();
    expect(pickers.at(-1)).toMatchObject({ current: "08 Tasks/Inbox", purpose: "capture" });
    // Closing the shared picker without invoking submit must leave the draft unchanged.
    modal.syncDraftsFromForms();
    expect(modal.drafts[0].destination).toBeUndefined();
    expect(root.button("Use Inbox").hidden).toBe(true);
  });

  it("keeps destination changes and Inbox reset after a save attempt has synchronized the form", async () => {
    const { modal, root } = capture();
    root.button("Choose folder").click();
    await pickers.at(-1)!.submit("02 Programs/CalWORKs");
    modal.syncDraftsFromForms();
    root.button("Choose folder").click();
    expect(pickers.at(-1)!.current).toBe("02 Programs/CalWORKs");
    await pickers.at(-1)!.submit("03 Areas/Misc");
    modal.syncDraftsFromForms();
    expect(modal.drafts[0].destination).toBe("03 Areas/Misc");
    expect(root.descendants().some((element) => element.text === "03 Areas/Misc")).toBe(true);
    root.button("Use Inbox").click();
    modal.syncDraftsFromForms();
    expect(modal.drafts[0]).toMatchObject({ title: "Capture example", details: "Keep details", people: ["Franklin"], project: "Existing project", source: { title: "Keep source" } });
    expect(modal.drafts[0].destination).toBeUndefined();
    expect(root.button("Use Inbox").hidden).toBe(true);
  });
});
