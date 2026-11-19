import { expect, it, vi } from "vitest";
import type { TaskStatus } from "@fjg/task-core";
import type { IndexedTask } from "./workspace-service";
const menus = vi.hoisted(() => [] as any[]);
vi.mock("obsidian", () => ({ setIcon: vi.fn(), Menu: class {
  items: any[] = [];
  constructor() { menus.push(this); }
  addItem(fn: (item: any) => void) { const item = { title: "", run: () => {}, setTitle(s: string) { this.title = s; return this; }, setIcon() { return this; }, setChecked() { return this; }, onClick(fn: () => void) { this.run = fn; return this; } }; fn(item); this.items.push(item); }
  addSeparator() {} showAtPosition() {}
} }));
import { renderOverviewGroups } from "./overview-view";
class Element {
  hidden = false;
  children: Element[] = []; events: Record<string, (e: any) => void> = {};
  constructor(public options: any = {}) {}
  createDiv(options: any) { const child = new Element(options); this.children.push(child); return child; }
  createEl(_tag: string, options: any) { return this.createDiv(options); }
  createSpan(options: any) { return this.createDiv(options); }
  setAttribute(key: string, value: string) { (this.options.attr ??= {})[key] = value; }
  addEventListener(name: string, fn: (e: any) => void) { this.events[name] = fn; }
  addClass() {} removeClass() {} contains() { return false; } querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, bottom: 30 }; }
  find(cls: string): Element[] { return [...(this.options.cls === cls ? [this] : []), ...this.children.flatMap(child => child.find(cls))]; }
}
it("routes title, People, status and drag actions by stable ID without changing records", () => {
  const root = new Element();
  const task = { record: { task_id: "stable-id", title: "Objective", status: "do-first", people: ["Alex"], agenda_selected: false } } as IndexedTask;
  const before = JSON.stringify(task);
  const actions = { open: vi.fn(), copyPath: vi.fn(), people: vi.fn(), move: vi.fn() };
  renderOverviewGroups(root as unknown as HTMLElement, [task], actions);
  expect(root.find("fjg-overview-group")).toHaveLength(8);
  expect(root.find("fjg-overview-row")).toHaveLength(1);
  expect(root.find("fjg-overview-toggle")).toHaveLength(0);
  root.find("fjg-overview-title")[0].events.click({}); expect(actions.open).toHaveBeenCalledWith("stable-id");
  root.find("fjg-overview-menu")[0].events.click({});
  menus.at(-1).items.find((item: any) => item.title === "Assign People…").run(); expect(actions.people).toHaveBeenCalledWith("stable-id");
  menus.at(-1).items.find((item: any) => item.title === "Copy vault folder path").run(); expect(actions.copyPath).toHaveBeenCalledWith("stable-id");
  menus.at(-1).items.find((item: any) => item.title === "Waiting").run(); expect(actions.move).toHaveBeenCalledWith("stable-id", "waiting");
  const payload = new Map<string,string>();
  root.find("fjg-overview-row")[0].events.dragstart({dataTransfer: {setData: (key: string, value: string) => payload.set(key,value)}});
  const target = root.find("fjg-overview-group").find(el => el.options.attr["data-overview-status"] === "ongoing")!;
  target.events.drop({ preventDefault() {}, dataTransfer: {getData: (key: string) => payload.get(key)}});
  expect(actions.move).toHaveBeenCalledWith("stable-id", "ongoing");
  expect(JSON.stringify(task)).toBe(before);
});

it("toggles each Overview status in place and preserves choices across rendering and search", () => {
  const task = { record: { task_id: "stable-id", title: "Objective", status: "do-first" } } as IndexedTask;
  const actions = { open: vi.fn(), copyPath: vi.fn(), people: vi.fn(), move: vi.fn() };
  const collapsed = new Set<TaskStatus>();
  const render = (search = false) => {
    const root = new Element();
    renderOverviewGroups(root as unknown as HTMLElement, [task], actions, "stable-id", search ? undefined : collapsed);
    return root;
  };
  const group = (root: Element, status: TaskStatus) => root.find("fjg-overview-group")
    .find(el => el.options.attr["data-overview-status"] === status)!;
  const root = render();
  const first = group(root, "do-first");
  const toggle = first.find("fjg-overview-toggle")[0];
  const body = first.find("fjg-overview-body")[0];
  expect(toggle.options.attr["aria-controls"]).toBe(body.options.attr.id);
  expect(toggle.options.attr["aria-expanded"]).toBe("true");
  expect(body.hidden).toBe(false);
  toggle.events.click({});
  expect(toggle.options.attr["aria-expanded"]).toBe("false");
  expect(body.hidden).toBe(true);
  expect(collapsed).toEqual(new Set(["do-first"]));
  expect(group(root, "ongoing").find("fjg-overview-body")[0].hidden).toBe(false);
  first.events.drop({ preventDefault() {}, dataTransfer: { getData: () => "another-id" } });
  expect(actions.move).toHaveBeenCalledWith("another-id", "do-first");

  const afterRefresh = group(render(), "do-first");
  expect(afterRefresh.find("fjg-overview-body")[0].hidden).toBe(true);
  expect(afterRefresh.find("fjg-overview-row")).toHaveLength(0);
  const searching = group(render(true), "do-first");
  expect(searching.find("fjg-overview-body")[0].hidden).toBe(false);
  expect(searching.find("fjg-overview-title")[0].options.text).toBe("Objective");
  expect(collapsed).toEqual(new Set(["do-first"]));

  const afterSearch = group(render(), "do-first");
  const nextToggle = afterSearch.find("fjg-overview-toggle")[0];
  expect(nextToggle.options.attr["aria-controls"]).not.toBe(toggle.options.attr["aria-controls"]);
  nextToggle.events.click({});
  expect(nextToggle.options.attr["aria-expanded"]).toBe("true");
  expect(afterSearch.find("fjg-overview-body")[0].hidden).toBe(false);
  expect(collapsed.size).toBe(0);
  afterSearch.find("fjg-overview-title")[0].events.click({});
  expect(actions.open).toHaveBeenCalledWith("stable-id");
  nextToggle.events.click({});
  nextToggle.events.click({});
  expect(afterSearch.find("fjg-overview-row")).toHaveLength(1);
});
