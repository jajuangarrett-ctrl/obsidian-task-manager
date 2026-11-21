import { TFile } from "obsidian";
import { LiveVoiceModal } from "../../../apps/obsidian-plugin/src/live-voice-modal";
import { LIVE_CONVERSATION_VIEW, LiveConversationView } from "../../../apps/obsidian-plugin/src/live-conversation-view";
import { report } from "./session";

const workspaceEl = document.querySelector<HTMLElement>(".workspace")!;
const rootEl = workspaceEl.querySelector<HTMLElement>(".workspace-split.mod-root")!;
const tasks = ["Budget review", "Planning calendar"].map((title,index) => ({
  record: { title, task_id: `fixture-${index+1}`, project: "Mock Projects", status: "do-soon", due: "", updated_at: "2026-01-01", subtasks: [] },
  taskFile: new TFile(`Mock Projects/${title}.md`, { mtime: 123 } as any), notes: `A fictional ${title.toLowerCase()} fixture.`,
  updates: [], archived: false,
}));
let active: Leaf | undefined;
const leaves: Leaf[] = [];
const render = () => {
  for (const leaf of leaves) {
    leaf.root.hidden = leaf !== active;
    leaf.root.classList.toggle("mod-active",leaf === active);
  }
};

class Leaf {
  root = rootEl.createDiv({ cls: "workspace-leaf" });
  header = this.root.createDiv({ cls: "view-header" });
  view: any;
  label = this.header.createSpan();
  type = "";
  menu?: HTMLElement;
  constructor() { leaves.push(this); render(); }
  async setViewState({ type }: { type: string }) {
    if (type !== LIVE_CONVERSATION_VIEW) throw new Error("Unsupported mock view");
    this.type = type; this.root.dataset.viewType=type; this.label.setText("Talk to Vault · Mock workspace");
    this.header.createEl("button", { text:"×", attr:{ "aria-label":"Close chat pane" } }).onclick = () => this.detach();
    this.view = new LiveConversationView(this as any);
    await this.view.onOpen();
  }
  async openFile(file: TFile, _opts: unknown) {
    const task = tasks.find(t => t.taskFile === file);
    if (!task) throw new Error("Not a fixture file");
    this.type = "markdown"; this.root.dataset.viewType=this.type; this.root.dataset.file=file.path;
    this.menu?.remove();
    this.root.querySelector(".view-content")?.remove();
    for (const old of this.header.querySelectorAll("button, .native-menu")) old.remove();
    this.label.setText("Markdown · Mock native leaf");
    const overflow = this.header.createEl("button", { text:"⋯", attr:{ "aria-label":"Native note overflow", "aria-expanded":"false" } });
    const menu = this.menu = document.body.createDiv({ cls:"menu native-menu", attr:{ role:"menu", "aria-label":"Mock native note menu" } }); menu.hidden = true;
    const toggle = (show: boolean) => {
      const bounds = overflow.getBoundingClientRect();
      menu.style.top = `${bounds.bottom + 2}px`;
      menu.style.right = `${Math.max(4, innerWidth - bounds.right)}px`;
      menu.hidden = !show; overflow.setAttribute("aria-expanded",String(show));
    };
    overflow.onclick = () => toggle(menu.hidden);
    for (const text of ["Reading view", "Copy note link (mock)", "Close note"]) {
      menu.createEl("button", { text, attr: { role:"menuitem" } }).onclick = () => {
        toggle(false); report(`Mock native menu action: ${text}`);
        if (text === "Close note") this.detach();
      };
    }
    const content = this.root.createDiv({ cls:"view-content native-markdown" });
    content.createEl("h1",{ text:task.record.title });
    content.createEl("p",{ text:task.notes });
    content.createEl("p",{ text:"Synthetic Markdown view: this pane is owned by the mock Obsidian workspace, not the chat." });
    content.createEl("p",{ text:file.path });
    this.view = { getState: () => ({ file: file.path }) };
    active = this; render(); report(`Opened mock native note: ${task.record.title}`);
  }
  detach() {
    const index = leaves.indexOf(this);
    if (index < 0) return;
    leaves.splice(index,1);
    this.menu?.remove();
    if (active === this) active = leaves.at(-1);
    this.root.remove(); render();
    void this.view?.onClose?.();
  }
}
const workspace = {
  containerEl: workspaceEl,
  getLeaf: (_kind: string) => new Leaf(),
  getMostRecentLeaf: () => active,
  createLeafBySplit: () => { throw new Error("The mobile fixture renders only the active group"); },
  getLeavesOfType: (type: string) => leaves.filter(leaf => leaf.type === type),
  revealLeaf: async (leaf: Leaf) => { if (leaves.includes(leaf)) { active = leaf; render(); } },
};
const app = { workspace };
const plugin = {
  settings: { liveBackendModel:"synthetic", activeRoot:"Mock Projects" },
  workspaceService: {
    refresh: async () => {},
    list: () => tasks,
    getById: (id: string) => { const task = tasks.find(t => t.record.task_id === id); if (!task) throw new Error("Unknown fixture task"); return task; },
  },
  resolveOpenAiApiKey: async () => "fixture-only", refreshDashboard: () => {},
};
const dashboard = new Leaf();
dashboard.type = "dashboard"; dashboard.label.setText("Mock dashboard");
const home = dashboard.root.createDiv({ cls:"view-content native-markdown" });
home.createEl("h1",{ text:"Talk to Vault QA" });
home.createEl("p",{ text:"Choose Talk to Vault, then Type a message. Send “Find my budget,” open Budget review, and try Chat, Note, and the native note overflow. Send “Find my calendar” to switch notes in the same conversation." });
active = dashboard; render(); report();
let modal: LiveVoiceModal | undefined;
document.querySelector<HTMLButtonElement>("#talk")!.onclick = () => {
  if (modal) { modal.restore(); return; }
  modal = new LiveVoiceModal(app as any, plugin as any, () => "synthetic objective context", () => { modal = undefined; });
  modal.open();
};
// Override only the visual viewport values read by the production typing layout.
const visual = new EventTarget();
let keyboard = false;
Object.defineProperties(visual, {
  scale: { value: 1 }, offsetTop: { value: 0 }, offsetLeft: { value: 0 }, width: { get: () => innerWidth },
  height: { get: () => Math.max(160, innerHeight - (keyboard ? 255 : 0)) },
});
Object.defineProperty(window,"visualViewport",{ configurable:true, value:visual });
window.addEventListener("resize",() => visual.dispatchEvent(new Event("resize")));
window.addEventListener("fixture-keyboard",event => {
  keyboard = (event as CustomEvent<boolean>).detail;
  document.body.dataset.keyboard = String(keyboard);
  document.querySelector<HTMLElement>("#fixture-keyboard")!.hidden = !keyboard;
  const input = document.querySelector<HTMLInputElement>('.fjg-live-search-form input');
  if (keyboard && input && input.offsetWidth) input.focus({ preventScroll:true });
  else if (!keyboard) input?.blur();
  visual.dispatchEvent(new Event("resize"));
});
