import { Platform, requestUrl } from "obsidian";
import { backendInstructions, LIVE_INSTRUCTIONS, LIVE_TOOLS, LiveToolLoop } from "./live-tools";

export type LiveState = "idle" | "connecting" | "connected" | "ending" | "ended" | "error";
export interface LiveCallbacks {
  state: (state: LiveState, message: string) => void;
  transcript: (speaker: "You" | "Assistant", delta: string) => void;
  busy?: (busy: boolean) => void;
  execute: (name: string, args: string, id: string) => Promise<unknown>;
}

export function liveRequest(sdp: string, backendModel: string, context: string) {
  return { session: { model: "gpt-live-1", instructions: LIVE_INSTRUCTIONS,
    delegation: { type: "responses", responses: { model: backendModel, instructions: backendInstructions(context),
      tools: LIVE_TOOLS, tool_choice: "auto", parallel_tool_calls: false, max_output_tokens: 1800 } } },
    transport: { type: "webrtc", sdp } };
}

/** Runs in Obsidian's trusted plugin runtime, using its native HTTP API for the saved key. */
export class DashboardLiveSession {
  private backendBusy = false;
  private backendHasTools = false;
  private inputMode: "voice" | "text" = "voice";
  private silentContext?: AudioContext;
  private silentSource?: OscillatorNode;
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private microphone?: MediaStream;
  private ready = false;
  private sessionStarted = false;
  private readinessTimer?: ReturnType<typeof setTimeout>;
  private audioStableSince = 0;
  private lastAudioBytes = 0;
  private lastAudioProgress = 0;
  private playbackBlocked = false;
  private disposed = false;
  private ending = false;
  private timer?: ReturnType<typeof setTimeout>;
  private loop: LiveToolLoop;
  constructor(private audio: HTMLAudioElement, private callbacks: LiveCallbacks) {
    this.loop = new LiveToolLoop(callbacks.execute, (event) => this.send(event));
  }
  get active(): boolean { return this.ready && !this.disposed && !this.ending; }

  async start(apiKey: string, backendModel: string, context: string, inputMode: "voice" | "text" = "voice"): Promise<void> {
    if (this.disposed) return;
    this.inputMode = inputMode;
    this.callbacks.state("connecting", inputMode === "text" ? "Connecting for typed messages and spoken replies… Microphone off." : "Connecting… Please wait before speaking.");
    try {
      if (!apiKey.trim()) throw new Error("Add your OpenAI API key in FJG Task Manager settings.");
      if ((inputMode === "voice" && !navigator.mediaDevices?.getUserMedia) || typeof RTCPeerConnection === "undefined") throw new Error("Live voice is not supported on this device.");
      const peer = this.peer = new RTCPeerConnection();
      peer.addEventListener("track", (event) => {
        if (this.disposed || this.ending) return;
        this.audio.srcObject = new MediaStream([event.track]);
        void this.audio.play().catch(() => {
          this.playbackBlocked = true;
          if (this.active) this.callbacks.state("connected", this.textOnly ? "Ready to type. Microphone off. Press play below to hear replies." : "Ready — start speaking. Press play below to hear replies.");
        });
      });
      // Start from the user's click; never automatically reopen a microphone after disconnecting.
      let microphone: MediaStream;
      if (inputMode === "text") {
        // A generated silent track negotiates two-way audio without accessing any input device.
        const context = this.silentContext = new AudioContext();
        const destination = context.createMediaStreamDestination();
        const source = this.silentSource = context.createOscillator();
        const gain = context.createGain(); gain.gain.value = 0;
        source.connect(gain); gain.connect(destination); source.start();
        let resumeTimer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          context.resume(),
          new Promise<never>((_, reject) => { resumeTimer = setTimeout(() => reject(new Error("Audio playback could not start. Close this panel and try Type a message again.")), 10000); })
        ]).finally(() => clearTimeout(resumeTimer));
        microphone = destination.stream;
      } else {
        microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      }
      if (this.disposed) { microphone.getTracks().forEach((track) => track.stop()); return; }
      this.microphone = microphone;
      for (const track of microphone.getAudioTracks()) peer.addTrack(track, microphone);
      const channel = this.channel = peer.createDataChannel("oai-events");
      channel.addEventListener("message", ({ data }) => {
        try { this.onEvent(JSON.parse(data)); }
        catch { this.fail("The voice connection returned an unreadable event."); }
      });
      channel.addEventListener("close", () => {
        if (!this.disposed) this.fail("Voice connection closed. Any saved changes remain saved. Start again to reconnect.");
      });
      peer.addEventListener("connectionstatechange", () => {
        if (!this.disposed && ["failed", "disconnected"].includes(peer.connectionState)) this.fail("Voice disconnected. Any saved changes remain saved. Start again to reconnect.");
      });
      await peer.setLocalDescription(await peer.createOffer());
      await this.waitForIce(peer);
      if (this.disposed) return;
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error("Could not prepare the microphone connection.");
      this.timer = setTimeout(() => this.fail("Voice connection timed out. Check your network and API model access, then try again."), 30000);
      const response = await requestUrl({ url: "https://api.openai.com/v1/live/sessions", method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(liveRequest(sdp, backendModel, context)), throw: false });
      if (this.disposed) return;
      if (response.status >= 400) {
        const hint = response.status === 401 ? "Check your saved OpenAI API key." : response.status === 403 || response.status === 404 ? "Check that your OpenAI project has GPT-Live-1 and backend model access." : response.status === 429 ? "Check your OpenAI quota or try again later." : "Try again after checking your OpenAI account and network.";
        throw new Error(`Voice connection failed (HTTP ${response.status}). ${hint}`);
      }
      if (typeof response.json?.transport?.sdp !== "string") throw new Error("OpenAI did not return a voice connection answer.");
      await peer.setRemoteDescription({ type: "answer", sdp: response.json.transport.sdp });
      // POST starts the session. Wait for session.started; never send session.start.
    } catch (error) {
      if (!this.disposed) this.fail(error instanceof Error && error.name === "NotAllowedError"
        ? "Microphone access was denied. Allow Obsidian microphone access in system settings and try again."
        : error instanceof Error ? error.message : "Could not connect voice.");
    }
  }

  async enableMicrophone(): Promise<void> {
    if (!this.active || !this.textOnly) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!this.active) { stream.getTracks().forEach(track => track.stop()); return; }
      const sender = this.peer?.getSenders().find(sender => sender.track?.kind === "audio");
      if (!sender) { stream.getTracks().forEach(track => track.stop()); throw new Error("No audio sender"); }
      try { await sender.replaceTrack(stream.getAudioTracks()[0]); }
      catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
      if (!this.active) { stream.getTracks().forEach(track => track.stop()); return; }
      this.microphone?.getTracks().forEach(track => track.stop());
      this.microphone = stream;
      this.silentSource?.stop(); this.silentSource = undefined;
      void this.silentContext?.close().catch(() => {}); this.silentContext = undefined;
      this.inputMode = "voice";
      this.ready = false; this.audioStableSince = 0; this.lastAudioBytes = 0;
      this.callbacks.state("connecting", "Warming up microphone… Please wait before speaking.");
      this.timer = setTimeout(() => this.fail("Microphone did not become ready. Ended the connection."), 30000);
      void this.checkAudioReady();
    } catch {
      if (this.active) this.callbacks.state("connected", "Could not turn on microphone. You can continue typing.");
    }
  }

  get textOnly(): boolean { return this.inputMode === "text"; }
  get acceptingText(): boolean { return this.active && !this.backendBusy && this.channel?.readyState === "open"; }

  sendText(text: string): boolean {
    const value = text.trim();
    if (!value || value.length > 4000 || !this.acceptingText) return false;
    this.backendBusy = true;
    this.callbacks.busy?.(true);
    this.callbacks.transcript("You", value);
    this.send({ type: "response.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: value }] } });
    this.send({ type: "response.create" });
    return true;
  }

  mute(muted: boolean): void { this.microphone?.getAudioTracks().forEach((track) => { track.enabled = !muted; }); }

  end(): void {
    if (this.disposed || this.ending) return;
    this.ending = true;
    this.loop.stop();
    // End immediately disables input and further writes; keep the channel for final usage.
    this.mute(true);
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.audio.pause();
    if (this.sessionStarted && this.channel?.readyState === "open") {
      this.callbacks.state("ending", "Ending conversation…");
      this.send({ type: "session.close" });
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.dispose(); this.callbacks.state("ended", "Conversation ended; final usage was not received."); }, 5000);
    } else {
      this.dispose();
      this.callbacks.state("ended", "Conversation ended.");
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    clearTimeout(this.timer);
    clearTimeout(this.readinessTimer);
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.silentSource?.stop();
    void this.silentContext?.close().catch(() => {});
    this.channel?.close();
    this.peer?.close();
    this.audio.pause();
    this.audio.srcObject = null;
    this.ready = false;
  }

  private onEvent(event: Record<string, any>): void {
    if (this.disposed) return;
    if (event.type === "session.started") {
      if (this.sessionStarted || this.ending) return;
      this.sessionStarted = true;
      if (this.inputMode === "text") {
        this.ready = true;
        clearTimeout(this.timer);
        this.callbacks.state("connected", this.playbackBlocked ? "Ready to type. Microphone off. Press play below to hear replies." : "Ready to type. Microphone off; replies play aloud.");
      } else {
        this.callbacks.state("connecting", "Warming up microphone… Please wait before speaking.");
        void this.checkAudioReady();
      }
    } else if (event.type === "session.closed") {
      this.dispose();
      this.callbacks.state("ended", "Conversation ended.");
    } else if (event.type === "error") {
      this.fail("OpenAI reported a voice session error. Ended the connection; saved changes remain saved.");
    } else if (["session.input_transcript.delta", "session.output_transcript.delta"].includes(event.type) && typeof event.delta === "string") {
      this.callbacks.transcript(event.type === "session.input_transcript.delta" ? "You" : "Assistant", event.delta);
    } else if (event.type === "response.event" && this.active) {
      const nested = event.event;
      if (nested?.type === "response.created") { this.backendBusy = true; this.backendHasTools = false; this.callbacks.busy?.(true); }
      if (nested?.type === "response.output_item.done" && nested.item?.type === "function_call") this.backendHasTools = true;
      const final = nested?.type === "response.completed" && !this.backendHasTools;
      void this.loop.handle(event).then(() => {
        if (final && this.active) { this.backendBusy = false; this.callbacks.busy?.(false); }
      }).catch(() => this.fail("Could not finish a voice task request. Check the dashboard before trying the change again."));
      if (["response.failed", "response.cancelled", "response.incomplete"].includes(nested?.type)) {
        this.fail("The backend request did not complete. Check your objectives before retrying any change.");
      }
    }
  }

  /** A session event alone does not establish that the phone audio path is sending. */
  private async checkAudioReady(): Promise<void> {
    if (this.disposed || this.ending || this.ready) return;
    try {
      const peer = this.peer;
      const track = this.microphone?.getAudioTracks()[0];
      let bytes = 0;
      if (peer?.connectionState === "connected" && track?.readyState === "live" && !track.muted && track.enabled) {
        const stats = await peer.getStats();
        stats.forEach((report) => {
          if (report.type === "outbound-rtp" && (report.kind === "audio" || report.mediaType === "audio")) bytes += report.bytesSent || 0;
        });
      }
      if (this.disposed || this.ending) return;
      if (bytes > this.lastAudioBytes) {
        if (!this.audioStableSince) this.audioStableSince = Date.now();
        this.lastAudioProgress = Date.now();
      }
      if (bytes > 0 && this.audioStableSince && Date.now() - this.lastAudioProgress < 1500) {
        // Conservative mobile warm-up for reported loss of the opening phrase.
        // Packet flow is transport evidence, not proof of server speech recognition.
        if (Date.now() - this.audioStableSince >= (Platform.isMobile ? 3500 : 200)) {
          this.ready = true;
          clearTimeout(this.timer);
          this.callbacks.state("connected", this.playbackBlocked ? "Ready — start speaking. Press play below to hear replies." : "Ready — start speaking");
          return;
        }
      } else {
        this.audioStableSince = 0;
      }
      this.lastAudioBytes = bytes;
    } catch {
      this.audioStableSince = 0;
    }
    this.readinessTimer = setTimeout(() => void this.checkAudioReady(), 200);
  }

  private send(event: Record<string, unknown>): void {
    if (!this.disposed && this.channel?.readyState === "open") this.channel.send(JSON.stringify({ event_id: crypto.randomUUID(), ...event }));
  }

  private fail(message: string): void {
    if (this.disposed) return;
    this.dispose();
    this.callbacks.state("error", message);
  }

  private waitForIce(peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = () => {
        if (peer.iceGatheringState !== "complete") return;
        clearTimeout(timeout); peer.removeEventListener("icegatheringstatechange", done); resolve();
      };
      const timeout = setTimeout(() => { peer.removeEventListener("icegatheringstatechange", done); reject(new Error("Timed out preparing voice. Check your network.")); }, 10000);
      peer.addEventListener("icegatheringstatechange", done); done();
    });
  }
}
