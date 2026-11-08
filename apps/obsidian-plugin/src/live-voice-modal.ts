import { Modal, type App } from "obsidian";
import type FjgTaskManagerPlugin from "../main";
import { DashboardLiveSession, type LiveState } from "./live-session";
import { LiveTaskTools } from "./live-tools";

import { DashboardTextSession } from "./dashboard-text-session";

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
  private searchGeneration = 0;
  private textSession?: DashboardTextSession;
  private cancelSearchButton!: HTMLButtonElement;
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
    panel.createEl("p", { text: "Ask advanced questions about your objectives. Submit sends your question, conversation history, dashboard context and requested objective content to OpenAI using your saved API key and voice backend model. API charges apply. Microphone stays off; typed search cannot change objectives.", cls: "fjg-live-caption" });
    const form = panel.createEl("form", { cls: "fjg-live-search-form", attr: { role: "search", "aria-label": "Search objectives" } });
    const label = form.createEl("label", { text: "Search objectives" });
    this.searchInput = label.createEl("input", { type: "text", placeholder: "Ask about your objectives…", attr: { maxlength: "4000", "aria-label": "Search objectives", enterkeyhint: "search" } });
    this.searchButton = form.createEl("button", { text: "Ask AI", type: "submit" });
    form.addEventListener("submit", event => { event.preventDefault(); void this.searchObjectives(); });
    this.cancelSearchButton = panel.createEl("button", { text: "Cancel search" });
    this.cancelSearchButton.disabled = true;
    this.cancelSearchButton.addEventListener("click", () => this.cancelTextSearch());
    const reset = panel.createEl("button", { text: "New search conversation" });
    reset.addEventListener("click", () => {
      this.cancelTextSearch(); this.textSession?.reset(); this.searchResults.empty();
      this.searchStatus.setText("New conversation. Ask a question to search with AI."); this.searchInput.focus();
    });
    this.searchStatus = panel.createEl("p", { text: "Ask a question, then press Enter or Ask AI. Follow-up questions use this text conversation.", attr: { role: "status", "aria-live": "polite" } });
    this.searchResults = panel.createDiv({ cls: "fjg-live-search-results", attr: { "aria-label": "Objective search results" } });
  }

  private cancelTextSearch(): void {
    this.searchGeneration++;
    this.textSession?.cancel();
    this.searchBusy = false;
    this.searchButton.disabled = false;
    this.searchButton.setText("Ask AI");
    this.cancelSearchButton.disabled = true;
    this.searchResults.setAttribute("aria-busy", "false");
    this.searchStatus.setText("Search cancelled. Requests already sent may still incur API charges.");
  }

  private async searchObjectives(): Promise<void> {
    if (this.closed || this.searchBusy) return;
    const query = this.searchInput.value.trim();
    if (!query) { this.searchStatus.setText("Enter a question to search your objectives."); this.searchInput.focus(); return; }
    this.searchBusy = true;
    const generation = ++this.searchGeneration;
    const active = () => !this.closed && generation === this.searchGeneration;
    this.searchButton.disabled = true;
    this.cancelSearchButton.disabled = false;
    this.searchButton.setText("Searching…");
    this.searchResults.setAttribute("aria-busy", "true");
    this.searchStatus.setText("Asking AI to search your objectives…");
    const turn = this.searchResults.createDiv({ cls: "fjg-live-search-turn" });
    turn.createEl("strong", { text: `You: ${query}` });
    const answer = turn.createEl("p", { cls: "fjg-live-search-answer" });
    const sources = turn.createEl("ul");
    const seen = new Set<string>();
    const tools = new LiveTaskTools(this.plugin.workspaceService, () => this.plugin.settings, () => {}, active,
      message => { if (active()) this.searchStatus.setText(message); });
    // Each turn gets a fresh guarded executor while retaining successful conversation history.
    this.textSession ??= new DashboardTextSession((name, args, id) => this.textExecute!(name, args, id));
    this.textExecute = async (name, args, id) => {
      if (!active()) throw new Error("Search cancelled.");
      const result = await tools.execute(name, args, id) as { tasks?: { task_id: string; title: string }[]; task_id?: string; title?: string };
      if (!active()) throw new Error("Search cancelled.");
      const candidates = result.tasks ?? (result.task_id && result.title ? [{ task_id: result.task_id, title: result.title }] : []);
      for (const task of candidates) {
        if (seen.has(task.task_id)) continue;
        seen.add(task.task_id);
        const open = sources.createEl("li").createEl("button", { text: task.title, attr: { "aria-label": `Open objective: ${task.title}` } });
        open.addEventListener("click", () => {
          open.disabled = true;
          void this.plugin.openTask(task.task_id).then(() => { if (!this.closed) this.close(); }).catch(() => {
            if (!this.closed) { open.disabled = false; this.searchStatus.setText("Could not open this objective. Search again to refresh the results."); }
          });
        });
      }
      return result;
    };
    try {
      const key = await this.plugin.resolveOpenAiApiKey();
      if (!active()) return;
      const response = await this.textSession.ask(query, key, this.plugin.settings.liveBackendModel, this.context());
      if (!active()) return;
      answer.setText(response);
      this.searchStatus.setText("Answer ready. Ask a follow-up or open a matching objective below.");
      if (this.searchInput.value.trim() === query) this.searchInput.value = "";
      this.searchInput.focus();
    } catch (error) {
      if (active()) {
        answer.setText("This question did not complete. It was not added to the conversation history.");
        this.searchStatus.setText(error instanceof Error ? error.message : "Could not complete the AI search. Check your API settings and try again.");
      }
    } finally {
      if (active()) {
        this.searchBusy = false; this.searchButton.disabled = false; this.searchButton.setText("Ask AI");
        this.cancelSearchButton.disabled = true; this.searchResults.setAttribute("aria-busy", "false");
      }
    }
  }

  private textExecute?: (name: string, args: string, id: string) => Promise<unknown>;

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
    this.searchGeneration++;
    this.textSession?.cancel();
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
