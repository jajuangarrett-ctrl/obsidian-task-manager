import { Modal, type App } from "obsidian";
import type FjgTaskManagerPlugin from "../main";
import { DashboardLiveSession, type LiveState } from "./live-session";
import { LiveTaskTools } from "./live-tools";

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
  private textInput!: HTMLInputElement;
  private textButton!: HTMLButtonElement;
  private pendingText = "";
  private lastSpeaker = "";
  private lastText?: HTMLElement;

  constructor(app: App, private plugin: FjgTaskManagerPlugin, private context: () => string, private released: () => void) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Talk to your dashboard");
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
    this.renderTextComposer(root);
    this.updates = root.createDiv({ cls: "fjg-live-updates", attr: { role: "log", "aria-label": "Saved task changes", "aria-live": "polite" } });
  }

  private renderTextComposer(root: HTMLElement): void {
    const toggle = root.createEl("button", { text: "Type a message", attr: { "aria-expanded": "false" } });
    const panel = root.createDiv({ cls: "fjg-live-text-search" }); panel.hidden = true;
    toggle.addEventListener("click", () => {
      panel.hidden = !panel.hidden; toggle.setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) this.textInput.focus();
    });
    panel.createEl("p", { text: "Type instead of speaking, with the same AI tools and spoken replies. Sending starts a paid OpenAI session with your saved key and shares your message and requested objective context. Clear change requests save immediately. Starting by text does not access your microphone.", cls: "fjg-live-caption" });
    const form = panel.createEl("form", { cls: "fjg-live-search-form" });
    const label = form.createEl("label", { text: "Message your dashboard" });
    this.textInput = label.createEl("input", { type: "text", placeholder: "Ask a question or request a change…", attr: { maxlength: "4000", "aria-label": "Message your dashboard", enterkeyhint: "send" } });
    this.textButton = form.createEl("button", { text: "Send message", type: "submit" });
    form.addEventListener("submit", event => { event.preventDefault(); void this.submitText(); });
  }

  private async submitText(): Promise<void> {
    if (this.closed || this.textButton.disabled) return;
    const text = this.textInput.value.trim();
    if (!text) { this.status.setText("Type a message before sending."); this.textInput.focus(); return; }
    if (this.session?.active) {
      this.lastText = undefined;
      if (this.session.sendText(text)) this.textInput.value = "";
      else this.status.setText("Wait for the current request to finish before sending another message.");
      return;
    }
    this.pendingText = text;
    await this.start("text");
  }

  async start(inputMode: "voice" | "text" = "voice"): Promise<void> {
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
      busy: busy => { if (!this.closed) this.textButton.disabled = busy; },
      transcript: (speaker, delta) => this.addTranscript(speaker, delta),
      execute: (name, args, id) => tools.execute(name, args, id)
    });
    this.session = session;
    this.setState("connecting", "Connecting… Please wait before speaking.");
    try {
      const key = await this.plugin.resolveOpenAiApiKey();
      if (this.closed || this.session !== session) return;
      await session.start(key, this.plugin.settings.liveBackendModel, this.context(), inputMode);
    } catch {
      session.dispose();
      this.setState("error", "Could not read the saved OpenAI key. Check FJG Task Manager settings.");
    }
  }

  onClose(): void {
    this.closed = true;
    this.pendingText = "";
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
    this.muteButton.disabled = state !== "connected" || Boolean(this.session?.textOnly);
    this.textButton.disabled = ["connecting", "ending"].includes(state);
    if (["error", "ended"].includes(state)) this.pendingText = "";
    if (state === "connected" && this.pendingText && this.session?.acceptingText) {
      const text = this.pendingText; this.pendingText = "";
      this.lastText = undefined;
      if (this.session.sendText(text) && this.textInput.value.trim() === text) this.textInput.value = "";
    }
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
