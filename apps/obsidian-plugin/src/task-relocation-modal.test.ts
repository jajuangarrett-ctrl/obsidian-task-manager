import { describe, expect, it, vi } from "vitest";

class Element {
  children: Element[] = [];
  value = ""; text = ""; hidden = false; disabled = false;
  handlers = new Map<string, () => void>();
  constructor(public tag = "div") {}
  createEl(tag: string, options: { text?: string } = {}) { const child = new Element(tag); child.text = options.text || ""; this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  addClass() {}
  empty() { this.children = []; }
  focus() {}
  addEventListener(name: string, handler: () => void) { this.handlers.set(name, handler); }
  all(): Element[] { return this.children.flatMap((child) => [child, ...child.all()]); }
}

vi.mock("obsidian", () => ({
  Modal: class { close = vi.fn(); setTitle = vi.fn(); },
  Notice: vi.fn(), setIcon: vi.fn(),
  Setting: class {
    constructor(private parent: Element) {}
    addButton(callback: (button: unknown) => void) {
      const element = this.parent.createEl("button");
      const api = { setButtonText: (text: string) => { element.text = text; return api; }, setDisabled: (value: boolean) => { element.disabled = value; return api; }, setCta: () => api, onClick: (handler: () => void) => { element.handlers.set("click", handler); return api; } };
      callback(api); return this;
    }
  }
}));
vi.mock("./capture-live/panel", () => ({ CaptureVoice: class {}, captureKey: vi.fn(), settingFields: vi.fn() }));
import { TaskRelocationModal } from "./modals";

function picker(purpose?: "capture") {
  vi.stubGlobal("window", { setTimeout: vi.fn() });
  const submit = vi.fn(async (_path: string) => {});
  const modal = new TaskRelocationModal({} as never, "Example", "08 Tasks/Inbox", ["02 Programs/CalWORKs", "03 Areas/Misc"], submit, purpose);
  const content = new Element();
  Object.assign(modal, { contentEl: content, modalEl: new Element() });
  modal.onOpen();
  return { modal, content, submit };
}

describe("shared objective folder picker", () => {
  it("keeps the search input stable while filtering and cancels capture without saving", () => {
    const { modal, content, submit } = picker("capture");
    const search = content.all().find((element) => element.tag === "input")!;
    search.value = "03 Areas/Misc"; search.handlers.get("input")!();
    expect(content.all().find((element) => element.tag === "input")).toBe(search);
    expect(content.all().some((element) => element.text === "03 Areas/Misc")).toBe(true);
    expect(content.all().some((element) => element.text === "02 Programs/CalWORKs")).toBe(false);
    expect(content.all().find((element) => element.text === "Use this folder")?.disabled).toBe(true);
    content.all().find((element) => element.text === "Cancel")!.handlers.get("click")!();
    expect(modal.close).toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  });

  it("retains the existing Move wording and submits only the reviewed selected folder", async () => {
    const { modal, content, submit } = picker();
    expect(modal.setTitle).toHaveBeenCalledWith("Move objective: Example");
    expect(content.all().some((element) => element.text === "Current location: 08 Tasks/Inbox")).toBe(true);
    content.all().find((element) => element.text === "02 Programs/CalWORKs")!.handlers.get("click")!();
    const save = content.all().find((element) => element.text === "Move objective")!;
    expect(save.disabled).toBe(false); await save.handlers.get("click")!();
    expect(submit).toHaveBeenCalledExactlyOnceWith("02 Programs/CalWORKs");
  });
});
