const create = function (tag, options = {}, callback) {
  const el = this.ownerDocument.createElement(tag);
  if (options.text !== undefined) el.textContent = options.text;
  if (options.cls) el.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
  if (options.type) el.setAttribute("type", options.type);
  if (options.value !== undefined) el.value = options.value;
  if (options.placeholder !== undefined) el.placeholder = options.placeholder;
  if (options.title !== undefined) el.title = options.title;
  for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, String(value));
  this.append(el);
  callback?.(el);
  return el;
};
Object.assign(HTMLElement.prototype, {
  createEl: create,
  createDiv(options, callback) { return create.call(this, "div", options, callback); },
  createSpan(options, callback) { return create.call(this, "span", options, callback); },
  addClass(...classes) { this.classList.add(...classes); },
  removeClass(...classes) { this.classList.remove(...classes); },
  toggleClass(classes, enabled) { for (const c of Array.isArray(classes) ? classes : [classes]) this.classList.toggle(c, enabled); },
  hasClass(cls) { return this.classList.contains(cls); },
  setText(text) { this.textContent = text; },
  setAttr(name, value) { if (value === null || value === undefined) this.removeAttribute(name); else this.setAttribute(name, String(value)); },
  setAttrs(values) { for (const [name, value] of Object.entries(values)) this.setAttr(name, value); },
  appendText(text) { this.append(text); },
  detach() { this.remove(); },
  empty() { this.replaceChildren(); },
  isShown() { return this.isConnected && this.getClientRects().length > 0; },
});
Object.defineProperties(HTMLElement.prototype, { win: { get() { return this.ownerDocument.defaultView; } }, doc: { get() { return this.ownerDocument; } } });
export const Platform = { isMobile: true, isPhone: true, isIosApp: true, isDesktop: false };
export const normalizePath = (path) => path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
export class TFile {
  constructor(path) {
    this.path = path; this.name = path.split("/").at(-1); this.extension = this.name.split(".").at(-1);
    this.basename = this.name.slice(0, this.name.length - this.extension.length - 1);
    this.stat = { mtime: 1, size: 64, ctime: 1 };
    this.parent = new TFolder(path.slice(0, path.lastIndexOf("/")));
  }
}
export class TFolder {
  constructor(path) { this.path = path; this.name = path.split("/").at(-1); this.children = []; }
}
export class Component {
  cleanup = [];
  load() {}
  unload() { for (const fn of this.cleanup.splice(0).reverse()) fn(); }
  register(fn) { this.cleanup.push(fn); }
  registerEvent(fn) { if (typeof fn === "function") this.register(fn); }
  registerDomEvent(target, event, fn, opts) { target.addEventListener(event, fn, opts); this.register(() => target.removeEventListener(event, fn, opts)); }
}
export class ItemView extends Component {
  async setState() {}

  constructor(leaf) {
    super(); this.leaf = leaf; this.app = leaf.app; this.containerEl = leaf.containerEl;
    this.contentEl = leaf.containerEl.createDiv({ cls: "view-content" });
  }
}
export class Notice {
  constructor(message) { window.fixtureEvents.push({ name: "notice", args: [String(message)] }); }
}
export class Menu {
  addItem(configure) { configure({ setTitle() { return this; }, setIcon() { return this; }, setChecked() { return this; }, onClick() { return this; } }); return this; }
  addSeparator() { return this; }
  showAtPosition() {}
  showAtMouseEvent() {}
}
export function setIcon(el, name) { el.dataset.icon = name; }
export function setTooltip(el, text) { el.title = text; }
export const MarkdownRenderer = { async render(_app, markdown, target) { target.textContent = markdown; } };
export class Modal extends Component {}
export class WorkspaceLeaf {}
export const Keymap = { isModEvent: () => "tab" };
export class FuzzySuggestModal extends Modal {}
export class Setting {}
export async function requestUrl() { throw new Error("Network is forbidden in this fixture."); }
