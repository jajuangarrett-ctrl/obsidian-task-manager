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
    this.status = root.createEl("p", { text: "Ready to talk", cls: "fjg-live-status", attr: { role: "status", "aria-live": "polite" } });
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
      this.status.setText(this.muted ? "Microphone muted" : "Listening · GPT-Live-1");
    });
    this.endButton = controls.createEl("button", { text: "End conversation" });
    this.endButton.disabled = true;
    this.endButton.addEventListener("click", () => this.session?.end());
    this.audio = root.createEl("audio", { attr: { controls: "", autoplay: "", "aria-label": "Assistant voice playback" } });
    this.transcript = root.createDiv({ cls: "fjg-live-transcript", attr: { role: "log", "aria-label": "Conversation transcript", "aria-live": "polite" } });
    this.transcript.createEl("p", { text: "Try: “What is due this week?” or “Mark my budget review task completed.”", cls: "fjg-live-caption" });
    this.updates = root.createDiv({ cls: "fjg-live-updates", attr: { role: "log", "aria-label": "Saved task changes", "aria-live": "polite" } });
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
    this.setState("connecting", "Preparing voice…");
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
