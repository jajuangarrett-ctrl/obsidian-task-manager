type Callbacks = {
  state: (state: string, message: string) => void;
  busy?: (busy: boolean) => void;
  transcript: (who: "You"|"Assistant", text: string) => void;
  execute: (name: string, input: string, id: string) => Promise<any>;
};

export const counts = { sessions: 0, starts: 0, sends: 0, ends: 0, mic: 0 };
export function report(message?: string) {
  document.querySelector("#counts")!.textContent =
    `Sessions ${counts.sessions} · Starts ${counts.starts} · Sends ${counts.sends} · Ends ${counts.ends} · Mock mic ${counts.mic}`;
  if (message !== undefined) document.querySelector("#result")!.textContent = message;
}

export class DashboardLiveSession {
  private running = false;
  private busy = false;
  private disposed = false;
  private generation = 0;
  private mode: "voice"|"text" = "voice";
  get active() { return this.running && !this.disposed; }
  get textOnly() { return this.mode === "text"; }
  get acceptingText() { return this.active && !this.busy; }
  constructor(_audio: HTMLAudioElement, private callbacks: Callbacks) { counts.sessions++; report(); }
  prepareTextInput() { /* No Web Audio or microphone in this harness. */ }
  async start(_key: string, _model: string, _context: string, mode: "voice"|"text") {
    this.mode = mode; counts.starts++; report();
    this.callbacks.state("connecting", "Connecting to synthetic session…");
    await new Promise(resolve => setTimeout(resolve, 120));
    if (this.disposed) return;
    this.running = true;
    this.callbacks.state("connected", mode === "text" ? "Mock session connected. Microphone off." : "Mock voice session connected. No real audio.");
  }
  sendText(text: string): boolean {
    if (!text.trim() || !this.acceptingText) return false;
    const generation = ++this.generation;
    this.busy = true; counts.sends++; report("Synthetic request working…");
    this.callbacks.busy?.(true);
    this.callbacks.transcript("You", text);
    setTimeout(() => void this.respond(text,generation), 180);
    return true;
  }
  private async respond(text: string, generation: number) {
    if (!this.active || generation !== this.generation) return;
    const query = /calendar|timeline/i.test(text) ? "calendar" : "budget";
    try {
      const result = await this.callbacks.execute("find_tasks", JSON.stringify({ query, status:"", offset:0 }), `fixture-${counts.sends}`);
      if (!this.active || generation !== this.generation) return;
      const count = result.tasks.length;
      report(`Synthetic result: ${count} objective${count === 1 ? "" : "s"} for ${query}.`);
      this.callbacks.transcript("Assistant", count ? `I found ${result.tasks[0].title}. Select the referenced objective to open it in the mock native note view.` : "No fixture matched.");
    } catch {
      if (this.active) report("Synthetic tool failed.");
    } finally {
      if (this.active && generation === this.generation) { this.busy = false; this.callbacks.busy?.(false); }
    }
  }
  async enableMicrophone() { this.mode = "voice"; counts.mic++; report(); this.callbacks.state("connected", "Mock microphone on. No real audio."); }
  mute(_muted: boolean) { /* Not captured. */ }
  end() {
    if (this.disposed) return;
    this.dispose(); counts.ends++; report("Synthetic conversation ended.");
    this.callbacks.state("ended", "Conversation ended.");
  }
  dispose() { this.disposed = true; this.running = false; this.generation++; }
}
