import { Modal, Platform, type App, type WorkspaceLeaf } from "obsidian";
import type FjgTaskManagerPlugin from "../main";
import { DashboardLiveSession, type LiveState } from "./live-session";
import { LiveTaskTools } from "./live-tools";
import { canSplitLive, followLiveViewport } from "./live-presentation";
import { LIVE_CONVERSATION_VIEW, LiveConversationView } from "./live-conversation-view";
import { TASK_DASHBOARD_VIEW } from "./dashboard-view-type";
import { OBJECTIVES_APP_VIEW } from "./objectives-app-model";

type WorkspacePeer = { leaf: WorkspaceLeaf; view: WorkspaceLeaf["view"]; path?: string };

const microphoneDisclosure = "Your microphone and requested objective context go to OpenAI while connected. Uses your saved API key.";
const typingDisclosure = "Sending starts a paid OpenAI session using your saved key. OpenAI receives your message and requested objective context. Microphone stays off until you turn it on. Clear change requests save immediately.";

export class LiveVoiceModal extends Modal {
  private session?: DashboardLiveSession;
  private closed = false;
  private muted = false;
  private surface: "chat" | "docking" | "workspace" = "chat";
  private opening = false;
  private launchingLane = false;
  private navigationEpoch = 0;
  private chatLeaf?: WorkspaceLeaf;
  private noteLeaf?: WorkspaceLeaf;
  private notePath?: string;
  private launchPeer?: WorkspacePeer;
  private laneRoot?: HTMLElement;
  private lane?: HTMLElement;
  private laneWidth = 0;
  private stopLane?: () => void;
  private noteOnly = false;
  private conversationView?: LiveConversationView;
  private rendered = false;
  private state: LiveState = "idle";
  private showNote?: HTMLButtonElement;
  private audioHome?: HTMLElement;
  private noteBar?: HTMLElement;
  private barStatus?: HTMLElement;
  private barMute?: HTMLButtonElement;
  private barNote?: HTMLButtonElement;
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
    this.endButton.addEventListener("click", () => { this.navigationEpoch++; this.session?.end(); });
    this.showNote = controls.createEl("button", { text: "Show note", cls: "fjg-live-show-note" });
    this.showNote.hidden = true;
    this.showNote.addEventListener("click", () => this.revealNote());
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
    this.watchMobileLane();
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
    toggle.addEventListener("click", () => {
      const open = panel.hidden;
      setTyping(open);
      if (!open) void this.dockBesideCurrentView();
    });
    panel.createEl("p", { text: typingDisclosure, cls: "fjg-live-caption fjg-live-desktop-policy" });
    const form = panel.createEl("form", { cls: "fjg-live-search-form" });
    form.createEl("button", { text: "×", cls: "fjg-live-hide-keyboard", type: "button", attr: { "aria-label": "Hide typing" } })
      .addEventListener("click", () => { setTyping(false); void this.dockBesideCurrentView(); });
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
      else if (this.session.active) this.status.setText("Wait for the current request to finish before sending another message.");
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
      state: (state, message) => { if (this.session === session) this.setState(state, message); },
      busy: busy => { if (!this.closed && this.session === session) this.textButton.disabled = busy; },
      transcript: (speaker, delta) => { if (this.session === session) this.addTranscript(speaker, delta); },
      execute: async (name, args, id) => {
        if (this.closed || this.session !== session) throw new Error("Conversation ended.");
        const result = await tools.execute(name, args, id);
        if (!this.closed && this.session === session && (name === "find_tasks" || name === "read_task")) {
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
    // Preserve the explicit Send user gesture before the asynchronous saved-key lookup.
    try { if (inputMode === "text") session.prepareTextInput(); }
    catch {
      session.dispose();
      this.setState("error", "Could not prepare audio playback. Your draft is kept; try Send again. Microphone remains off.");
      return;
    }
    this.setState("connecting", "Connecting… Please wait before speaking.");
    try {
      const key = await this.plugin.resolveOpenAiApiKey();
      if (this.closed || this.session !== session) return;
      await session.start(key, this.plugin.settings.liveBackendModel, this.context(), inputMode);
    } catch {
      session.dispose();
      if (this.closed || this.session !== session) return;
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
      this.containerEl.classList.toggle("fjg-live-short", keyboardVisible && !!vv && vv.height < 280);
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

  private async openObjective(taskId: string, _origin: "voice" | "reference", active: () => boolean = () => true): Promise<void> {
    if (this.closed || this.opening || !active()) throw new Error("Conversation ended or an objective is already opening.");
    this.opening = true;
    const epoch = ++this.navigationEpoch;
    let createdChat: WorkspaceLeaf | undefined;
    let createdNote: WorkspaceLeaf | undefined;
    const current = () => !this.closed && this.navigationEpoch === epoch && active();
    try {
      const workspace = this.app.workspace;
      // Resolve identity locally again, never a model-supplied file path or arbitrary native tab.
      const task = this.plugin.workspaceService.getById(taskId);
      if (!this.chatLeaf) {
        createdChat = workspace.getLeaf("tab");
        await createdChat.setViewState({ type: LIVE_CONVERSATION_VIEW, active: false });
        if (!current()) throw new Error("Objective opening was cancelled. Your chat was not restarted.");
        if (!(createdChat.view instanceof LiveConversationView)) throw new Error("Chat pane is unavailable.");
        if (createdChat.view.contentEl.ownerDocument !== this.contentEl.ownerDocument) throw new Error("Keep Talk to Vault in its original window.");
      }
      const chat = this.chatLeaf ?? createdChat!;
      let note = this.noteLeaf;
      // Reuse only a leaf that still contains the selected native Markdown view. If the
      // owner navigated it elsewhere, open another leaf rather than replacing their work.
      if (note && (!workspace.getLeavesOfType("markdown").includes(note) || note.view.getState().file !== this.notePath)) note = undefined;
      if (!note) {
        const wide = this.containerEl.ownerDocument.defaultView?.matchMedia("(min-width: 760px)").matches;
        createdNote = wide && !Platform.isMobile ? workspace.createLeafBySplit(chat, "vertical", false) : workspace.getLeaf("tab");
        note = createdNote;
      }
      if (!current()) throw new Error("Objective opening was cancelled. Your chat was not restarted.");
      const fresh = this.plugin.workspaceService.getById(taskId);
      if (fresh.taskFile !== task.taskFile) throw new Error("Objective changed; search again.");
      await note.openFile(fresh.taskFile, { active: true, state: { mode: "preview" } });
      if (!current()) throw new Error("Objective opening was cancelled. Your chat was not restarted.");
      this.noteLeaf = note;
      this.notePath = fresh.taskFile.path;
      createdNote = undefined;
      if (createdChat) {
        this.transferToWorkspace(createdChat);
        createdChat = undefined;
      }
      this.updatePeerControls();
      await workspace.revealLeaf(note);
      if (!current()) throw new Error("Objective opening was cancelled. Your chat was not restarted.");
      this.noteOnly = false;
      this.watchMobileLane();
      createdChat = createdNote = undefined;
    } finally {
      // Only new leaves from this operation are removed after a failed/cancelled transfer.
      // Never detach a user's pre-existing native note or unrelated workspace leaf.
      if (createdNote && createdNote !== this.noteLeaf) createdNote.detach();
      if (createdChat && createdChat !== this.chatLeaf) createdChat.detach();
      this.opening = false;
    }
  }

  private ensureNoteBar(): void {
    if (this.closed || this.noteBar) return;
    const doc = this.contentEl.ownerDocument;
    this.noteBar = doc.body.createDiv({ cls: "fjg-live-note-bar fjg-live-workspace-switch", attr: { "aria-label": "Talk to Vault controls", role: "group" } });
    this.barStatus = this.noteBar.createSpan({ cls: "fjg-live-note-status", attr: { role: "status", "aria-live": "polite" } });
    this.noteBar.createEl("button", { text: "Chat", attr: { "aria-label": "Return to Talk to Vault conversation" } })
      .addEventListener("click", () => this.restore());
    this.barNote = this.noteBar.createEl("button", { text: "Note", attr: { "aria-label": "Show note" } });
    this.barNote.addEventListener("click", () => this.revealNote());
    this.barMute = this.noteBar.createEl("button", { text: "Mute", attr: { "aria-label": "Mute microphone", "aria-pressed": "false" } });
    this.barMute.addEventListener("click", () => this.toggleMute());
    this.barEnd = this.noteBar.createEl("button", { text: "End", attr: { "aria-label": "End conversation" } });
    this.barEnd.addEventListener("click", () => {
      if (this.state === "connecting" || this.state === "connected") { this.navigationEpoch++; this.session?.end(); }
      else if (this.state !== "ending") this.close();
    });
    this.updateNoteBar();
  }

  /** Use the existing real workspace view; never open or read a file merely to lay out chat. */
  private activePeer(visibleOnly = false): WorkspacePeer | undefined {
    const { workspace } = this.app;
    const leaf = workspace.getMostRecentLeaf?.(workspace.rootSplit);
    const view = leaf?.view, container = view?.containerEl;
    if (!leaf || !view || !container || !this.laneRoot?.contains(container)) return;
    if (visibleOnly && !container.getClientRects().length) return;
    const kind = view.getViewType();
    const path = kind === "markdown" ? view.getState().file : undefined;
    if (typeof path === "string" && path) return { leaf, view, path };
    if (kind === TASK_DASHBOARD_VIEW || kind === OBJECTIVES_APP_VIEW) return { leaf, view };
  }

  private peerStillValid(peer: WorkspacePeer): boolean {
    return this.app.workspace.getLeavesOfType(peer.view.getViewType()).includes(peer.leaf)
      && peer.leaf.view === peer.view && (peer.path === undefined || peer.view.getState().file === peer.path);
  }

  private get returnPeer(): WorkspacePeer | undefined {
    if (this.noteLeaf && this.app.workspace.getLeavesOfType("markdown").includes(this.noteLeaf)
        && this.noteLeaf.view.getState().file === this.notePath) {
      return { leaf: this.noteLeaf, view: this.noteLeaf.view, path: this.notePath };
    }
    if (this.launchPeer && this.peerStillValid(this.launchPeer)) return this.launchPeer;
  }

  private updatePeerControls(): void {
    const peer = this.returnPeer;
    const noun = peer?.path ? "note" : "dashboard";
    if (this.showNote) {
      this.showNote.hidden = !peer;
      this.showNote.setText("Show " + noun);
    }
    if (this.barNote) {
      this.barNote.hidden = !peer;
      this.barNote.setText(peer?.path ? "Note" : "Dashboard");
      this.barNote.setAttribute("aria-label", "Show " + noun);
    }
  }

  private revealNote(): void {
    this.noteOnly = true; this.unmountMobileLane();
    if (this.closed) return;
    const peer = this.returnPeer;
    if (!peer) {
      this.status.setText("The opened note was closed or changed. Choose the objective again; your chat is still here.");
      this.restore();
      return;
    }
    void this.app.workspace.revealLeaf(peer.leaf);
  }

  restore(): void {
    if (this.closed) return;
    this.noteOnly = false;
    if (this.mountMobileLane()) return;
    if (this.chatLeaf) void this.app.workspace.revealLeaf(this.chatLeaf);
    else void this.dockBesideCurrentView();
  }

  private transferToWorkspace(chat: WorkspaceLeaf): void {
    if (!(chat.view instanceof LiveConversationView)) throw new Error("Chat pane is unavailable.");
    const view = chat.view;
    view.attachConversation(this.contentEl, () => {
      // An Obsidian view replacement may close this ItemView. Never detach the replacement.
      this.chatLeaf = undefined; this.conversationView = undefined; this.close();
    });
    this.chatLeaf = chat;
    this.conversationView = view;
    this.contentEl.addClass("fjg-live-pane-content");
    this.surface = "docking";
    this.shouldRestoreSelection = false;
    if (this.containerEl.ownerDocument.activeElement === this.textInput) this.textInput.blur();
    super.close();
    // The modal's delayed onClose only completes this ownership transfer.
    this.ensureNoteBar();
  }

  private laneAvailable(): boolean {
    const root = this.laneRoot;
    return !this.closed && !this.noteOnly && !!root?.isConnected
      && canSplitLive(this.laneWidth, !!this.lane)
      && !root.querySelector(":scope > .fjgduo-vault-live-split-pane");
  }

  private async dockBesideCurrentView(): Promise<void> {
    if (this.surface !== "chat" || this.opening || this.launchingLane || !this.laneAvailable()
        || this.contentEl.ownerDocument.activeElement === this.textInput) return;
    const peer = this.activePeer(true);
    if (!peer) return;
    this.launchingLane = true;
    const epoch = this.navigationEpoch;
    let chat: WorkspaceLeaf | undefined;
    try {
      const { workspace } = this.app;
      const existing = new Set<WorkspaceLeaf>();
      workspace.iterateAllLeaves?.(leaf => existing.add(leaf));
      const candidate = workspace.getLeaf("tab");
      if (existing.has(candidate)) return; // getLeaf("tab") may reuse a pre-existing empty tab.
      chat = candidate;
      await chat.setViewState({ type: LIVE_CONVERSATION_VIEW, active: false });
      const active = workspace.getMostRecentLeaf?.(workspace.rootSplit);
      if (this.navigationEpoch !== epoch || this.opening || this.surface !== "chat" || !this.laneAvailable()
          || this.contentEl.ownerDocument.activeElement === this.textInput || !this.peerStillValid(peer)
          || (active !== peer.leaf && active !== chat)) return;
      this.launchPeer = peer;
      this.transferToWorkspace(chat);
      chat = undefined;
      this.updatePeerControls();
      this.mountMobileLane();
    } catch {
      // Keep the original working modal if the host can't supply a native pane.
    } finally {
      if (chat?.view instanceof LiveConversationView || chat?.view.getViewType() === "empty") chat.detach();
      this.launchingLane = false;
    }
  }

  private watchMobileLane(): void {
    if (this.closed || !Platform.isMobile) return;
    if (this.stopLane) { this.mountMobileLane(); return; }
    const root = this.app.workspace.containerEl?.querySelector<HTMLElement>(".workspace-split.mod-root");
    if (!root?.isConnected || root.ownerDocument !== this.contentEl.ownerDocument) return;
    this.laneRoot = root;
    this.stopLane = followLiveViewport(root, width => {
      this.laneWidth = width;
      if (this.closed) return;
      if (!this.laneAvailable()) {
        const focused = !!this.lane?.contains(root.ownerDocument.activeElement);
        this.unmountMobileLane();
        if (focused && this.chatLeaf) void this.app.workspace.revealLeaf(this.chatLeaf);
      } else if (this.chatLeaf) this.mountMobileLane();
      else void this.dockBesideCurrentView();
    }, true);
  }

  private mountMobileLane(): boolean {
    const root = this.laneRoot;
    if (!root || !this.chatLeaf || !this.conversationView || !this.laneAvailable()) return false;
    const { workspace } = this.app;
    const active = workspace.getMostRecentLeaf?.(workspace.rootSplit);
    const returnPeer = this.returnPeer;
    if (active === this.chatLeaf && !returnPeer) return false;
    const prop = "--fjg-live-lane-pane-width";
    const width = `${Math.round(Math.max(288, Math.min(390, this.laneWidth * 0.42)))}px`;
    if (root.style.getPropertyValue(prop) !== width) root.style.setProperty(prop, width);
    if (!this.lane) {
      root.classList.add("fjg-live-lane-root");
      this.lane = root.createEl("aside", { cls: "fjg-live-lane", attr: { "aria-label": "Talk to Vault conversation" } });
      const header = this.lane.createDiv({ cls: "fjg-live-lane-header" });
      header.createEl("h2", { text: "Talk to Vault" });
      header.createEl("button", { text: "Close", attr: { "aria-label": "Close conversation" } }).addEventListener("click", () => this.close());
      this.lane.appendChild(this.contentEl);
    }
    // The owner may have selected Chat in the compact tab group. Show the already
    // requested note in-place; never create a duplicate editor or move its DOM.
    if (this.noteBar) this.noteBar.hidden = true;
    if (active === this.chatLeaf && returnPeer) void workspace.revealLeaf(returnPeer.leaf);
    return true;
  }

  private unmountMobileLane(): void {
    if (!this.lane) return;
    this.conversationView?.contentEl.appendChild(this.contentEl);
    this.lane.remove(); this.lane = undefined;
    if (this.noteBar) this.noteBar.hidden = false;
    this.laneRoot?.classList.remove("fjg-live-lane-root");
    this.laneRoot?.style.removeProperty("--fjg-live-lane-pane-width");
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
    this.noteBar = this.barStatus = this.barMute = this.barEnd = this.barNote = undefined;
  }

  override close(): void {
    if (this.closed) return;
    const nativeOpen = this.surface === "chat";
    this.finish();
    if (nativeOpen) super.close();
  }

  onClose(): void {
    this.stopViewport?.();
    if (!this.closed && this.surface === "docking") {
      this.surface = "workspace";
      return;
    }
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.navigationEpoch++;
    this.unmountMobileLane(); this.stopLane?.(); this.stopLane = undefined;
    this.conversationView?.releaseConversation();
    if (this.chatLeaf?.view === this.conversationView) this.chatLeaf?.detach();
    this.chatLeaf = undefined;
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
