type Options = { text?: string; cls?: string; type?: string; attr?: Record<string, string> };
function append(parent: HTMLElement, name: string, opts: Options = {}) {
  const el = parent.ownerDocument.createElement(name);
  if (opts.text) el.textContent = opts.text;
  if (opts.cls) el.className = opts.cls;
  if (opts.type) el.setAttribute("type", opts.type);
  for (const [key,val] of Object.entries(opts.attr ?? {})) el.setAttribute(key,val);
  parent.append(el);
  return el;
}
Object.assign(HTMLElement.prototype, {
  createEl(this: HTMLElement, name: string, opts?: Options) { return append(this,name,opts); },
  createDiv(this: HTMLElement, opts?: Options) { return append(this,"div",opts); },
  createSpan(this: HTMLElement, opts?: Options) { return append(this,"span",opts); },
  addClass(this: HTMLElement, ...names: string[]) { this.classList.add(...names); },
  setText(this: HTMLElement, text: string) { this.textContent = text; },
  appendText(this: HTMLElement, text: string) { this.append(text); },
  empty(this: HTMLElement) { this.replaceChildren(); },
});
export const Platform = { isMobile: true };
export const normalizePath = (path: string) => path.replace(/\/+/g,"/").replace(/^\/|\/$/g,"");
export class TFile { constructor(public path: string, public stat = { mtime: 123 }) {} }
export class TFolder {}
export class ItemView {
  contentEl: HTMLElement;
  constructor(leaf: any) { this.contentEl = leaf.root.createDiv({ cls: "view-content" }); }
}
export class Modal {
  containerEl = document.createElement("div");
  modalEl: HTMLElement; titleEl: HTMLElement; contentEl: HTMLElement;
  shouldRestoreSelection = true;
  constructor(public app: any) {
    this.containerEl.className = "modal-container";
    this.modalEl = this.containerEl.createDiv({ cls: "modal", attr: { role: "dialog", "aria-modal": "true" } });
    const header = this.modalEl.createDiv({ cls: "modal-header" });
    this.titleEl = header.createDiv({ cls: "modal-title" });
    this.modalEl.createEl("button", { text: "×", cls: "modal-close-button", attr: { "aria-label": "Close dialog" } }).addEventListener("click", () => this.close());
    this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
  }
  open() { document.body.append(this.containerEl); (this as any).onOpen?.(); }
  close() { this.containerEl.remove(); setTimeout(() => (this as any).onClose?.(), 0); }
}
