import { Modal, Platform, type App } from "obsidian";
import type FjgTaskManagerPlugin from "../main";
import { DashboardLiveSession, type LiveState } from "./live-session";
import { LiveTaskTools } from "./live-tools";

const microphoneDisclosure = "Your microphone and requested objective context go to OpenAI while connected. Uses your saved API key.";
const typingDisclosure = "Sending starts a paid OpenAI session using your saved key. OpenAI receives your message and requested objective context. Microphone stays off until you turn it on. Clear change requests save immediately.";

export class LiveVoiceModal extends Modal {
  private session?: DashboardLiveSession;
  private closed = false;
  private muted = false;
  private surface: "chat" | "minimizing" | "note" = "chat";
  private opening = false;
  private rendered = false;
  private hasNote = false;
  private state: LiveState = "idle";
  private showNote?: HTMLButtonElement;
  private audioHome?: HTMLElement;
  private noteBar?: HTMLElement;
  private barStatus?: HTMLElement;
  private barMute?: HTMLButtonElement;
  private barEnd?: HTMLButtonElement;
  private stopViewport?: () => void;
  private status!: HTMLElement;
  private coverage!: HTMLElement;
  private transcript!: HTMLElement;
  private sources!: HTMLElement;
  private updates!: HTMLElement;
  private audio!: HTMLAudioElement;
  private playbackButton!: HTMLButtonElement;
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
    this.titleEl.setText("Talk to Vault");
    this.modalEl.addClass("fjg-live-modal");
    this.attachMobileLayout();
    if (this.rendered) return;
    this.rendered = true;
    const root = this.contentEl;
    const info = root.createDiv({ cls: "fjg-live-info" });
    info.createEl("p", { text: "Ask about your objectives or say what to change. Clear requests save immediately.", cls: "fjg-live-intro" });
    info.createEl("p", { text: microphoneDisclosure, cls: "fjg-live-caption" });
    this.status = root.createEl("p", { text: "Microphone off — press Start conversation", cls: "fjg-live-status", attr: { role: "status", "aria-live": "polite" } });
    const controls = root.createDiv({ cls: "fjg-live-controls" });
    this.startButton = controls.createEl("button", { text: "Start conversation", cls: "mod-cta" });
    this.startButton.addEventListener("click", () => void this.start());
    this.muteButton = controls.createEl("button", { text: "Mute microphone", attr: { "aria-pressed": "false" } });
    this.muteButton.disabled = true;
    this.muteButton.addEventListener("click", () => {
      if (this.session?.textOnly) {
        this.muteButton.disabled = true;
        void this.session.enableMicrophone().finally(() => { if (!this.closed) this.muteButton.disabled = !this.session?.active; });
        return;
      }
      this.toggleMute();
    });
    this.endButton = controls.createEl("button", { text: "End conversation" });
    this.endButton.disabled = true;
    this.endButton.addEventListener("click", () => this.session?.end());
    this.showNote = controls.createEl("button", { text: "Show note", cls: "fjg-live-show-note" });
    this.showNote.hidden = true;
    this.showNote.addEventListener("click", () => this.minimize());
    this.audioHome = root.createDiv();
    this.audio = this.audioHome.createEl("audio", { attr: { autoplay: "", playsinline: "", "aria-label": "Assistant voice playback" } });
    this.audio.controls = !Platform.isMobile;
    this.playbackButton = controls.createEl("button", { text: "Play replies", cls: "fjg-live-playback" });
    this.playbackButton.hidden = true;
    this.playbackButton.addEventListener("click", () => {
      void this.audio.play().then(() => { this.playbackButton.hidden = true; }).catch(() => {
        if (!this.closed) this.status.setText("Could not play replies yet. Try Play replies again.");
      });
    });
    const scroll = root.createDiv({ cls: "fjg-live-scroll" });
    scroll.createEl("p", { text: microphoneDisclosure, cls: "fjg-live-caption fjg-live-mobile-policy" });
    scroll.createEl("p", { text: typingDisclosure, cls: "fjg-live-caption fjg-live-mobile-policy fjg-live-mobile-typing-policy" });
    this.coverage = scroll.createEl("p", { cls: "fjg-live-coverage", attr: { role: "status" } });
    this.transcript = scroll.createDiv({ cls: "fjg-live-transcript", attr: { role: "log", "aria-label": "Conversation transcript", "aria-live": "polite" } });
    this.transcript.createEl("p", { text: "Try: “What is due this week?” or “Mark my budget review task completed.”", cls: "fjg-live-caption" });
    this.sources = scroll.createDiv({ cls: "fjg-live-search-results", attr: { "aria-label": "Referenced objectives" } });
    this.updates = scroll.createDiv({ cls: "fjg-live-updates", attr: { role: "log", "aria-label": "Saved task changes", "aria-live": "polite" } });
    this.renderTextComposer(root);
  }

  private renderTextComposer(root: HTMLElement): void {
    const composer = root.createDiv({ cls: "fjg-live-composer" });
    const toggle = composer.createEl("button", { text: "Type a message", cls: "fjg-live-type-toggle", attr: { "aria-expanded": "false" } });
    const panel = composer.createDiv({ cls: "fjg-live-text-search" }); panel.hidden = true;
    const setTyping = (open: boolean) => {
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      root.dataset.typing = String(open);
      if (open) this.textInput.focus();
      else { this.textInput.blur(); toggle.focus({ preventScroll: true }); }
    };
    toggle.addEventListener("click", () => setTyping(panel.hidden));
    panel.createEl("p", { text: typingDisclosure, cls: "fjg-live-caption fjg-live-desktop-policy" });
    const form = panel.createEl("form", { cls: "fjg-live-search-form" });
    form.createEl("button", { text: "×", cls: "fjg-live-hide-keyboard", type: "button", attr: { "aria-label": "Hide typing" } })
      .addEventListener("click", () => setTyping(false));
    const label = form.createEl("label");
    label.createSpan({ text: "Message your dashboard", cls: "fjg-live-input-label" });
    this.textInput = label.createEl("input", { type: "text", placeholder: "Ask a question or request a change…", attr: { maxlength: "4000", "aria-label": "Message your dashboard", enterkeyhint: "send" } });
    this.textButton = form.createEl("button", { text: "Send", type: "submit", attr: { "aria-label": "Send message" } });
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
    }, () => !this.closed && session.active, message => { if (!this.closed) this.coverage.setText(message); },
    (taskId) => this.openObjective(taskId, "voice", () => session.active && this.session === session));
    session = new DashboardLiveSession(this.audio, {
      state: (state, message) => this.setState(state, message),
      busy: busy => { if (!this.closed) this.textButton.disabled = busy; },
      transcript: (speaker, delta) => this.addTranscript(speaker, delta),
      execute: async (name, args, id) => {
        const result = await tools.execute(name, args, id);
        if (!this.closed && (name === "find_tasks" || name === "read_task")) {
          const data = result as { tasks?: { task_id: string; title: string }[]; task_id?: string; title?: string };
          const tasks = data.tasks ?? (data.task_id && data.title ? [{ task_id: data.task_id, title: data.title }] : []);
          this.sources.empty();
          if (tasks.length) this.sources.createEl("p", { text: "Referenced objectives" });
          const list = this.sources.createEl("ul");
          for (const task of tasks) {
            const button = list.createEl("li").createEl("button", { text: task.title, attr: { "aria-label": `Open objective: ${task.title}` } });
            button.addEventListener("click", () => {
              button.disabled = true;
              void this.openObjective(task.task_id, "reference").catch(() => {
                if (!this.closed) this.status.setText("Could not open the objective. Ask to search again.");
              }).finally(() => { button.disabled = false; });
            });
          }
        }
        return result;
      }
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

  private attachMobileLayout(): void {
    this.stopViewport?.();
    const win = this.containerEl.ownerDocument.defaultView;
    if (!Platform.isMobile || !win) return;
    this.containerEl.classList.toggle("fjg-live-mobile", true);
    const media = win.matchMedia("(max-width: 600px)");
    const vv = win.visualViewport;
    const update = () => {
      const keyboardVisible = !!this.textInput && this.containerEl.ownerDocument.activeElement === this.textInput
        && !!vv && Math.abs(vv.scale - 1) < 0.02 && win.innerHeight - vv.height > 100;
      // Mobile keyboards can resize only the visual viewport; never infer a fold from keyboard width.
      this.containerEl.classList.toggle("fjg-live-compact", media.matches || keyboardVisible);
      if (this.showNote) this.showNote.hidden = !this.hasNote;
      if (!vv) return;
      this.containerEl.style.setProperty("--fjg-live-screen-height", `${vv.height}px`);
      this.containerEl.style.setProperty("--fjg-live-screen-top", `${vv.offsetTop}px`);
    };
    media.addEventListener("change", update);
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    update();
    this.stopViewport = () => {
      media.removeEventListener("change", update);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      this.stopViewport = undefined;
    };
  }

  private async openObjective(taskId: string, origin: "voice" | "reference", active: () => boolean = () => true): Promise<void> {
    if (this.closed || this.opening || !active()) throw new Error("Conversation ended or an objective is already opening.");
    this.opening = true;
    try {
      await this.plugin.openTask(taskId);
      if (this.closed || !active()) return;
      this.hasNote = true;
      if (Platform.isMobile) this.minimize();
      else if (origin === "reference") this.close();
    } finally {
      this.opening = false;
    }
  }

  private minimize(): void {
    if (this.closed || this.surface !== "chat" || !this.hasNote || !Platform.isMobile) return;
    this.surface = "minimizing";
    const doc = this.containerEl.ownerDocument;
    this.noteBar = doc.body.createDiv({ cls: "fjg-live-note-bar", attr: { "aria-label": "Talk to Vault controls", role: "group" } });
    this.noteBar.hidden = true;
    // Keep the same media element connected while the native modal detaches. Do not create another WebRTC session.
    this.noteBar.appendChild(this.audio);
    this.barStatus = this.noteBar.createSpan({ cls: "fjg-live-note-status", attr: { role: "status", "aria-live": "polite" } });
    this.noteBar.createEl("button", { text: "Chat", attr: { "aria-label": "Return to Talk to Vault conversation" } })
      .addEventListener("click", () => this.restore());
    this.barMute = this.noteBar.createEl("button", { text: "Mute", attr: { "aria-label": "Mute microphone", "aria-pressed": "false" } });
    this.barMute.addEventListener("click", () => this.toggleMute());
    this.barEnd = this.noteBar.createEl("button", { text: "End", attr: { "aria-label": "End conversation" } });
    this.barEnd.addEventListener("click", () => {
      if (this.state === "connecting" || this.state === "connected") this.session?.end();
      else if (this.state !== "ending") this.close();
    });
    this.updateNoteBar();
    if (doc.activeElement === this.textInput) this.textInput.blur();
    // Avoid pulling focus back into the dashboard and away from the newly opened note.
    this.shouldRestoreSelection = false;
    super.close();
  }

  restore(): void {
    if (this.closed || this.surface !== "note") return;
    this.surface = "chat";
    this.shouldRestoreSelection = true;
    this.audioHome?.appendChild(this.audio);
    this.removeNoteBar();
    this.open();
    if (this.hasNote) this.showNote?.focus({ preventScroll: true });
  }

  private toggleMute(): void {
    if (!this.session?.active || this.session.textOnly) return;
    this.muted = !this.muted;
    this.session.mute(this.muted);
    this.muteButton.setText(this.muted ? "Unmute microphone" : "Mute microphone");
    this.muteButton.setAttribute("aria-pressed", String(this.muted));
    this.status.setText(this.muted ? "Microphone muted" : "Ready — start speaking");
    this.updateNoteBar();
  }

  private updateNoteBar(): void {
    if (!this.barStatus || !this.barMute || !this.barEnd) return;
    const live = this.state === "connected";
    const voice = live && !this.session?.textOnly;
    this.barStatus.setText(voice ? (this.muted ? "Mic muted" : "Mic live") : live ? "Mic off" :
      this.state === "connecting" ? "Connecting" : this.state === "ending" ? "Ending" : "Chat paused");
    this.barMute.hidden = !voice;
    this.barMute.setText(this.muted ? "Unmute" : "Mute");
    this.barMute.setAttribute("aria-label", this.muted ? "Unmute microphone" : "Mute microphone");
    this.barMute.setAttribute("aria-pressed", String(this.muted));
    const canEnd = live || this.state === "connecting" || this.state === "ending";
    this.barEnd.setText(canEnd ? "End" : "Close");
    this.barEnd.setAttribute("aria-label", canEnd ? "End conversation" : "Close conversation");
    this.barEnd.disabled = this.state === "ending";
  }

  private removeNoteBar(): void {
    this.noteBar?.remove();
    this.noteBar = this.barStatus = this.barMute = this.barEnd = undefined;
  }

  override close(): void {
    if (this.closed) return;
    const nativeOpen = this.surface === "chat";
    this.finish();
    if (nativeOpen) super.close();
  }

  onClose(): void {
    this.stopViewport?.();
    if (!this.closed && this.surface === "minimizing") {
      this.surface = "note";
      if (this.noteBar) this.noteBar.hidden = false;
      return;
    }
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.pendingText = "";
    this.stopViewport?.();
    this.session?.end();
    this.removeNoteBar();
    this.released();
  }

  shutdown(): void { this.close(); this.session?.dispose(); }

  private setState(state: LiveState, message: string): void {
    if (this.closed) return;
    this.state = state;
    this.contentEl.dataset.state = state;
    this.status.setText(message);
    this.status.dataset.state = state;
    this.playbackButton.hidden = state !== "connected" || !message.includes("Press play below");
    this.startButton.setText(state === "connecting" ? "Connecting…" : state === "connected" ? "Conversation active" : "Start conversation");
    this.status.setAttribute("aria-busy", String(state === "connecting"));
    this.startButton.disabled = ["connecting", "connected", "ending"].includes(state);
    this.endButton.disabled = !["connecting", "connected"].includes(state);
    this.muteButton.disabled = state !== "connected";
    this.muteButton.setText(this.session?.textOnly ? "Turn on microphone" : this.muted ? "Unmute microphone" : "Mute microphone");
    this.textButton.disabled = ["connecting", "ending"].includes(state) || (state === "connected" && !this.session?.acceptingText);
    if (["error", "ended"].includes(state)) this.pendingText = "";
    this.updateNoteBar();
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
    if (!this.containerEl.classList.contains("fjg-live-mobile")) this.transcript.scrollTop = this.transcript.scrollHeight;
    else if (this.transcript.parentElement && (!this.sources.childElementCount || speaker === "You")) {
      this.transcript.parentElement.scrollTop = this.transcript.offsetTop + this.transcript.offsetHeight - this.transcript.parentElement.clientHeight;
    }
  }
}
