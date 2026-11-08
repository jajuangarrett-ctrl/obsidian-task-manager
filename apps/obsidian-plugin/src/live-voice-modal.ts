import { Modal, type App } from "obsidian";
import type FjgTaskManagerPlugin from "../main";
import { DashboardLiveSession, type LiveState } from "./live-session";
import { findIndexedTasks, LiveTaskTools } from "./live-tools";

export class LiveVoiceModal extends Modal {
  private session?: DashboardLiveSession;
  private closed = false;
  private muted = false;
  private status!: HTMLElement;
  private coverage!: HTMLElement;
  private transcript!: HTMLElement;
  private updates!: HTMLElement;
  private audio!: HTMLAudioElement;
  private startButton!: HTMLButtonElement;
  private muteButton!: HTMLButtonElement;
  private endButton!: HTMLButtonElement;
  private searchInput!: HTMLInputElement;
  private searchButton!: HTMLButtonElement;
  private searchStatus!: HTMLElement;
  private searchResults!: HTMLElement;
  private searchBusy = false;
  private lastSpeaker = "";
  private lastText?: HTMLElement;

  constructor(app: App, private plugin: FjgTaskManagerPlugin, private context: () => string, private released: () => void) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Talk to your dashboard");
    this.renderTextSearch(this.contentEl);
    this.modalEl.addClass("fjg-live-modal");
    const root = this.contentEl;
    root.createEl("p", { text: "Ask about your tasks or say what to change. Clear requests save immediately.", cls: "fjg-live-intro" });
    root.createEl("p", { text: "Your microphone and requested task context go to OpenAI while connected. Uses your saved API key.", cls: "fjg-live-caption" });
    this.coverage = root.createEl("p", { cls: "fjg-live-coverage", attr: { role: "status" } });
    this.status = root.createEl("p", { text: "Microphone off — press Start conversation", cls: "fjg-live-status", attr: { role: "status", "aria-live": "polite" } });
    const controls = root.createDiv({ cls: "fjg-live-controls" });
    this.startButton = controls.createEl("button", { text: "Start conversation", cls: "mod-cta" });
    this.startButton.addEventListener("click", () => void this.start());
    this.muteButton = controls.createEl("button", { text: "Mute microphone", attr: { "aria-pressed": "false" } });
    this.muteButton.disabled = true;
    this.muteButton.addEventListener("click", () => {
      this.muted = !this.muted;
      this.session?.mute(this.muted);
      this.muteButton.setText(this.muted ? "Unmute microphone" : "Mute microphone");
      this.muteButton.setAttribute("aria-pressed", String(this.muted));
      this.status.setText(this.muted ? "Microphone muted" : "Ready — start speaking");
    });
    this.endButton = controls.createEl("button", { text: "End conversation" });
    this.endButton.disabled = true;
    this.endButton.addEventListener("click", () => this.session?.end());
    this.audio = root.createEl("audio", { attr: { controls: "", autoplay: "", "aria-label": "Assistant voice playback" } });
    this.transcript = root.createDiv({ cls: "fjg-live-transcript", attr: { role: "log", "aria-label": "Conversation transcript", "aria-live": "polite" } });
    this.transcript.createEl("p", { text: "Try: “What is due this week?” or “Mark my budget review task completed.”", cls: "fjg-live-caption" });
    this.updates = root.createDiv({ cls: "fjg-live-updates", attr: { role: "log", "aria-label": "Saved task changes", "aria-live": "polite" } });
  }

  private renderTextSearch(root: HTMLElement): void {
    const toggle = root.createEl("button", { text: "Text search", attr: { "aria-expanded": "false" } });
    const panel = root.createDiv({ cls: "fjg-live-text-search" });
    panel.hidden = true;
    toggle.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) this.searchInput.focus();
    });
    panel.createEl("p", { text: "Search objectives, notes, updates and nested actions locally. No microphone or API key needed. This does not change your objectives.", cls: "fjg-live-caption" });
    const form = panel.createEl("form", { cls: "fjg-live-search-form", attr: { role: "search", "aria-label": "Search objectives" } });
    const label = form.createEl("label", { text: "Search objectives" });
    this.searchInput = label.createEl("input", { type: "search", placeholder: "Enter keywords…", attr: { maxlength: "300", "aria-label": "Search objectives", enterkeyhint: "search" } });
    this.searchButton = form.createEl("button", { text: "Search objectives", type: "submit" });
    form.addEventListener("submit", event => { event.preventDefault(); void this.searchObjectives(); });
    this.searchStatus = panel.createEl("p", { text: "Enter keywords, then press Enter or Search objectives.", attr: { role: "status", "aria-live": "polite" } });
    this.searchResults = panel.createDiv({ cls: "fjg-live-search-results", attr: { "aria-label": "Objective search results" } });
  }

  private async searchObjectives(): Promise<void> {
    if (this.closed || this.searchBusy) return;
    const query = this.searchInput.value.trim();
    this.searchResults.empty();
    if (!query) {
      this.searchStatus.setText("Enter keywords to search your objectives.");
      this.searchInput.focus();
      return;
    }
    this.searchBusy = true;
    this.searchButton.disabled = true;
    this.searchButton.setText("Searching…");
    this.searchResults.setAttribute("aria-busy", "true");
    this.searchStatus.setText("Searching indexed objectives…");
    try {
      await this.plugin.workspaceService.refresh();
      if (this.closed) return;
      const tasks = this.plugin.workspaceService.list({ includeArchived: true });
      const result = findIndexedTasks(tasks, query);
      this.searchStatus.setText(`${result.total ? `${result.total} matching objectives for “${query}”.` : `No objectives matched “${query}”. Try different keywords.`} ${result.coverage}`);
      // Keep a stable snapshot for paging; a fresh submit refreshes the index.
      let offset = 0;
      const list = this.searchResults.createEl("ul");
      const more = this.searchResults.createEl("button", { text: "Show more results" });
      const showPage = () => {
        const page = findIndexedTasks(tasks, query, "", offset);
        for (const task of page.tasks) {
          const row = list.createEl("li");
          const open = row.createEl("button", { text: task.title, attr: { "aria-label": `Open objective: ${task.title}` } });
          row.createEl("p", { text: [task.project, task.status, task.due ? `Due ${task.due}` : ""].filter(Boolean).join(" · "), cls: "fjg-live-caption" });
          open.addEventListener("click", () => {
            open.disabled = true;
            void this.plugin.openTask(task.task_id).then(() => { if (!this.closed) this.close(); }).catch(() => {
              if (!this.closed) { open.disabled = false; this.searchStatus.setText("Could not open this objective. Search again to refresh the results."); }
            });
          });
        }
        offset = page.next_offset ?? offset;
        more.hidden = page.next_offset === null;
        if (more.hidden && list.children.length) (list.lastElementChild?.querySelector("button") as HTMLButtonElement | null)?.focus();
      };
      more.addEventListener("click", showPage);
      showPage();
      // Keep focus in the query after the first page so it is easy to refine.
      this.searchInput.focus();
    } catch {
      if (!this.closed) this.searchStatus.setText("Could not search objectives. Try again after the workspace finishes loading.");
    } finally {
      this.searchBusy = false;
      if (!this.closed) {
        this.searchButton.disabled = false;
        this.searchButton.setText("Search objectives");
        this.searchResults.setAttribute("aria-busy", "false");
      }
    }
  }

  async start(): Promise<void> {
    if (this.closed || this.startButton.disabled) return;
    this.startButton.disabled = true;
    this.session?.dispose();
    this.muted = false;
    this.muteButton.setText("Mute microphone");
    this.muteButton.setAttribute("aria-pressed", "false");
    this.lastSpeaker = "";
    this.lastText = undefined;
    let session: DashboardLiveSession;
    const tools = new LiveTaskTools(this.plugin.workspaceService, () => this.plugin.settings, (message) => {
      this.plugin.refreshDashboard();
      if (!this.closed) this.updates.createEl("p", { text: message });
    }, () => !this.closed && session.active, message => { if (!this.closed) this.coverage.setText(message); });
    session = new DashboardLiveSession(this.audio, {
      state: (state, message) => this.setState(state, message),
      transcript: (speaker, delta) => this.addTranscript(speaker, delta),
      execute: (name, args, id) => tools.execute(name, args, id)
    });
    this.session = session;
    this.setState("connecting", "Connecting… Please wait before speaking.");
    try {
      const key = await this.plugin.resolveOpenAiApiKey();
      if (this.closed || this.session !== session) return;
      await session.start(key, this.plugin.settings.liveBackendModel, this.context());
    } catch {
      session.dispose();
      this.setState("error", "Could not read the saved OpenAI key. Check FJG Task Manager settings.");
    }
  }

  onClose(): void {
    this.closed = true;
    this.session?.end();
    // Immediately release the microphone when closing the panel; graceful close may finish in the background.
    this.released();
  }

  shutdown(): void { this.session?.end(); this.session?.dispose(); this.close(); }

  private setState(state: LiveState, message: string): void {
    if (this.closed) return;
    this.status.setText(message);
    this.status.dataset.state = state;
    this.startButton.setText(state === "connecting" ? "Connecting…" : state === "connected" ? "Conversation active" : "Start conversation");
    this.status.setAttribute("aria-busy", String(state === "connecting"));
    this.startButton.disabled = ["connecting", "connected", "ending"].includes(state);
    this.endButton.disabled = !["connecting", "connected"].includes(state);
    this.muteButton.disabled = state !== "connected";
  }

  private addTranscript(speaker: "You" | "Assistant", delta: string): void {
    if (this.closed) return;
    if (!this.lastText || speaker !== this.lastSpeaker) {
      const line = this.transcript.createEl("p");
      line.createEl("strong", { text: `${speaker}: ` });
      this.lastText = line.createSpan();
      this.lastSpeaker = speaker;
    }
    this.lastText.appendText(delta);
    while (this.transcript.children.length > 80) this.transcript.firstElementChild?.remove();
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }
}
