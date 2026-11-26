import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), platform: { isMobile: false } }));
vi.mock("obsidian", () => ({ requestUrl: mocks.request, Platform: mocks.platform }));
import { DashboardLiveSession, liveRequest } from "./live-session";

class Channel extends EventTarget {
  readyState = "open"; sent: any[] = [];
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = "closed"; }
  event(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })); }
}
class Peer extends EventTarget {
  static last: Peer;
  channel = new Channel(); iceGatheringState = "complete"; connectionState = "connected"; bytes = 0; flowing = true;
  localDescription = { sdp: "test-offer" }; closed = false;
  constructor() { super(); Peer.last = this; }
  async getStats() { if (this.flowing) this.bytes += 100; return new Map([["audio", { type: "outbound-rtp", kind: "audio", bytesSent: this.bytes }]]); }
  sender = { track: { kind: "audio" }, replaceTrack: vi.fn(async () => {}) };
  getSenders() { return [this.sender]; }
  addTrack() {} createDataChannel() { return this.channel; }
  async createOffer() { return { sdp: "test-offer" }; }
  async setLocalDescription() {} async setRemoteDescription() {}
  close() { this.closed = true; }
}
describe("Live connection lifecycle", () => {
  beforeEach(() => { vi.stubGlobal("RTCPeerConnection", Peer); mocks.request.mockReset(); mocks.platform.isMobile = false; vi.useFakeTimers(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const setup = () => {
    const track = { stop: vi.fn(), enabled: true, readyState: "live", muted: false };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
    const audio = { pause: vi.fn(), play: vi.fn(async () => {}), srcObject: null };
    const state = vi.fn(); const execute = vi.fn(); const transcript = vi.fn();
    return { audio, track, state, execute, transcript, session: new DashboardLiveSession(audio as any, { state, execute, transcript }) };
  };
  it("uses Live sessions with Responses tools, waits for ready, mutes, and gracefully ends", async () => {
    const { session, track } = setup();
    mocks.request.mockResolvedValue({ status: 201, json: { transport: { sdp: "answer" } } });
    await session.start("test-key", "gpt-5.6-terra", "context");
    expect(session.active).toBe(false);
    const channel = Peer.last.channel;
    expect(channel.sent).toEqual([]);
    channel.event({ type: "session.started" }); await vi.advanceTimersByTimeAsync(400); expect(session.active).toBe(true);
    session.mute(true); expect(track.enabled).toBe(false);
    session.mute(false); expect(track.enabled).toBe(true);
    session.end(); expect(session.active).toBe(false); expect(track.stop).toHaveBeenCalled();
    expect(channel.sent[0].type).toBe("session.close");
    channel.event({ type: "session.closed" }); expect(Peer.last.closed).toBe(true);
    const request = mocks.request.mock.calls[0][0];
    expect(request.url).toBe("https://api.openai.com/v1/live/sessions");
    expect(JSON.parse(request.body).session.model).toBe("gpt-live-1");
    expect(JSON.stringify(liveRequest("offer", "backend", "data"))).not.toContain("test-key");
  });
  it("does not announce readiness when playback is blocked before session startup", async () => {
    const { session, audio, state } = setup();
    vi.stubGlobal("MediaStream", class { constructor(_tracks: unknown[]) {} });
    audio.play.mockRejectedValue(new Error("blocked"));
    mocks.request.mockResolvedValue({ status: 201, json: { transport: { sdp: "answer" } } });
    await session.start("test-key", "backend", "context");
    const event = new Event("track"); Object.assign(event, { track: {} });
    Peer.last.dispatchEvent(event); await Promise.resolve();
    expect(state.mock.calls.some(([value]) => value === "connected")).toBe(false);
    expect(session.active).toBe(false);
    Peer.last.channel.event({ type: "session.started" });
    await vi.advanceTimersByTimeAsync(400);
    expect(state.mock.calls.at(-1)).toEqual(["connected", "Ready — start speaking. Press play below to hear replies."]);
    session.dispose();
  });
  it("waits for phone audio flow and warm-up, and never becomes ready after cancellation", async () => {
    mocks.platform.isMobile = true;
    const { session, state } = setup();
    mocks.request.mockResolvedValue({ status: 201, json: { transport: { sdp: "answer" } } });
    await session.start("test-key", "backend", "context");
    Peer.last.flowing = false;
    Peer.last.channel.event({ type: "session.started" });
    await vi.advanceTimersByTimeAsync(4000);
    expect(session.active).toBe(false);
    Peer.last.flowing = true;
    await vi.advanceTimersByTimeAsync(3000);
    expect(session.active).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.active).toBe(true);
    session.dispose();
    const cancelled = setup();
    await cancelled.session.start("test-key", "backend", "context");
    Peer.last.channel.event({ type: "session.started" });
    cancelled.session.end();
    await vi.advanceTimersByTimeAsync(6000);
    expect(cancelled.state.mock.calls.some(([state]) => state === "connected")).toBe(false);
    expect(state.mock.calls.some(([,message]) => message.includes("Warming up"))).toBe(true);
  });
  it("cleans up media on API denial and reports access failure without credentials", async () => {
    const { session, track, state } = setup();
    mocks.request.mockResolvedValue({ status: 403 });
    await session.start("test-key", "gpt-5.6-terra", "context");
    expect(track.stop).toHaveBeenCalled(); expect(Peer.last.closed).toBe(true);
    expect(state.mock.calls.at(-1)?.[0]).toBe("error"); expect(JSON.stringify(state.mock.calls)).not.toContain("test-key");
  });
  it("stops late microphone grants when cancelled before permission resolves", async () => {
    const { session, track } = setup();
    let resolve!: (value: any) => void;
    navigator.mediaDevices.getUserMedia = vi.fn(() => new Promise<MediaStream>((r) => { resolve = r; }));
    const pending = session.start("test-key", "backend", "context"); session.end();
    resolve({ getTracks: () => [track], getAudioTracks: () => [track] }); await pending;
    expect(track.stop).toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
  });
  it("handles unsupported mobile capture and connection timeout without leaving media active", async () => {
    vi.useFakeTimers();
    const { session, state, track } = setup();
    mocks.request.mockResolvedValue({ status: 201, json: { transport: { sdp: "answer" } } });
    await session.start("test-key", "backend", "context");
    await vi.advanceTimersByTimeAsync(30000);
    expect(track.stop).toHaveBeenCalled(); expect(state.mock.calls.at(-1)?.[0]).toBe("error");
    const unsupported = setup(); vi.stubGlobal("navigator", {});
    await unsupported.session.start("test-key", "backend", "context");
    expect(unsupported.state.mock.calls.at(-1)?.[1]).toContain("not supported");
  });
  it("starts typed conversation with generated silence, shares tools and spoken transport, and enables mic only explicitly", async () => {
    const { session, state, track, execute } = setup();
    const silentTrack = { kind: "audio", stop: vi.fn(), enabled: true };
    const stop = vi.fn(); const close = vi.fn(async () => {});
    vi.stubGlobal("AudioContext", class {
      state = "running";
      createMediaStreamDestination() { return { stream: { getTracks: () => [silentTrack], getAudioTracks: () => [silentTrack] } }; }
      createOscillator() { return { connect: vi.fn(), start: vi.fn(), stop }; }
      createGain() { return { gain: { value: 1 }, connect: vi.fn() }; }
      async resume() {} close = close;
    });
    mocks.request.mockResolvedValue({ status: 201, json: { transport: { sdp: "answer" } } });
    await session.start("test-key", "backend", "context", "text");
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(session.sendText("too early")).toBe(false);
    const channel = Peer.last.channel; channel.event({ type: "session.started" });
    expect(session.active).toBe(true); expect(session.textOnly).toBe(true);
    expect(session.sendText("Find my budget task")).toBe(true);
    expect(channel.sent[0]).toMatchObject({ type: "response.item.create", item: { role: "user", content: [{ type: "input_text", text: "Find my budget task" }] } });
    expect(channel.sent[1].type).toBe("response.create"); expect(session.sendText("duplicate")).toBe(false);
    channel.event({ type: "response.event", delegation_id: "d1", event: { type: "response.created", response: { id: "r1" } } });
    channel.event({ type: "response.event", delegation_id: "d1", event: { type: "response.completed", response: { id: "r1" } } });
    await vi.advanceTimersByTimeAsync(0); expect(session.acceptingText).toBe(true);
    expect(session.sendText("Read the budget task")).toBe(true);
    let finishTool!: (value: unknown) => void;
    execute.mockImplementationOnce(() => new Promise(resolve => { finishTool = resolve; }));
    channel.event({ type: "response.event", delegation_id: "d1", event: { type: "response.created", response: { id: "r2" } } });
    channel.event({ type: "response.event", delegation_id: "d1", event: { type: "response.output_item.done", item: { type: "function_call", name: "read_task", arguments: "{}", call_id: "read1" } } });
    channel.event({ type: "response.event", delegation_id: "d1", event: { type: "response.completed", response: { id: "r2" } } });
    await vi.advanceTimersByTimeAsync(0); expect(session.acceptingText).toBe(false);
    finishTool({ title: "Budget" }); await vi.advanceTimersByTimeAsync(0);
    expect(session.acceptingText).toBe(false); // continuation is still pending, even after function results.
    channel.event({ type: "response.event", delegation_id: "d1", event: { type: "response.created", response: { id: "r3" } } });
    channel.event({ type: "response.event", delegation_id: "d1", event: { type: "response.completed", response: { id: "r3" } } });
    await vi.advanceTimersByTimeAsync(0); expect(session.acceptingText).toBe(true);
    await session.enableMicrophone(); expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
    expect(Peer.last.sender.replaceTrack).toHaveBeenCalledWith(track); expect(silentTrack.stop).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400); expect(session.active).toBe(true); expect(session.textOnly).toBe(false);
    session.end(); expect(session.sendText("late")).toBe(false); session.dispose(); expect(close).toHaveBeenCalled();
  });
  it("keeps text enabled when an explicit microphone grant is denied", async () => {
    const { session } = setup();
    vi.stubGlobal("AudioContext", class {
      state = "running";
      createMediaStreamDestination() { return { stream: { getTracks: () => [], getAudioTracks: () => [] } }; }
      createOscillator() { return { connect() {}, start() {}, stop() {} }; }
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      async resume() {} async close() {}
    });
    mocks.request.mockResolvedValue({ status: 201, json: { transport: { sdp: "answer" } } });
    await session.start("key", "backend", "", "text"); Peer.last.channel.event({ type: "session.started" });
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new Error("denied"));
    await session.enableMicrophone(); expect(session.active).toBe(true); expect(session.textOnly).toBe(true); session.dispose();
  });

  const startText = async () => {
    const fixture = setup();
    const silentTrack = { kind: "audio", stop: vi.fn(), enabled: true };
    const resume = vi.fn(async () => {}); const close = vi.fn(async () => {});
    const construct = vi.fn();
    vi.stubGlobal("AudioContext", class {
      state = "running";
      constructor() { construct(); }
      createMediaStreamDestination() { return { stream: { getTracks: () => [silentTrack], getAudioTracks: () => [silentTrack] } }; }
      createOscillator() { return { connect() {}, start() {}, stop() {} }; }
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      resume = resume; close = close;
    });
    mocks.request.mockResolvedValue({ status: 201, json: { transport: { sdp: "answer" } } });
    await fixture.session.start("fixture", "backend", "", "text");
    Peer.last.channel.event({ type: "session.started" });
    return { ...fixture, channel: Peer.last.channel, silentTrack, resume, close, construct };
  };

  it.each([null, undefined])("executes and continues typed tools with delegation %s, once per call", async delegation => {
    const { session, channel, execute } = await startText();
    execute.mockResolvedValue({ title: "Budget" });
    const event = (nested: any) => channel.event({ type: "response.event", delegation_id: delegation, event: nested });
    expect(session.sendText("Read my budget")).toBe(true);
    event({ type: "response.created", response: { id: "typed-1" } });
    event({ type: "response.output_item.done", response_id: "typed-1", item: { type: "function_call", name: "read_task", arguments: "{}", call_id: "call-typed" } });
    event({ type: "response.completed", response: { id: "typed-1", output: [] } });
    event({ type: "response.completed", response: { id: "typed-1", output: [] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(channel.sent.map(e => e.type)).toEqual(["response.item.create", "response.create", "response.item.create", "response.create"]);
    expect(channel.sent[2].item.call_id).toBe("call-typed");
    expect(channel.sent.every(e => !("delegation_id" in e))).toBe(true);
    expect(session.acceptingText).toBe(false);
    event({ type: "response.created", response: { id: "typed-2" } });
    event({ type: "response.completed", response: { id: "typed-2" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.acceptingText).toBe(true);
    event({ type: "response.created", response: { id: "typed-1" } });
    event({ type: "response.completed", response: { id: "typed-1" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.acceptingText).toBe(true);
    expect(session.sendText("Now another question")).toBe(true);
    event({ type: "response.created", response: { id: "typed-3" } });
    event({ type: "response.completed", response: { id: "typed-3" } });
    await vi.advanceTimersByTimeAsync(0); expect(session.acceptingText).toBe(true);
    session.dispose();
  });

  it.each(["response.cancelled", "response.incomplete"])("keeps the session usable after %s without executing partial calls", async type => {
    const { session, channel, execute } = await startText();
    session.sendText("Find my task");
    channel.event({ type: "response.event", event: { type: "response.created", response: { id: "cancelled" } } });
    channel.event({ type: "response.event", event: { type: "response.output_item.done", item: { type: "function_call", name: "read_task", arguments: "{}", call_id: "partial" } } });
    channel.event({ type: "response.event", event: { type, response: { id: "cancelled" } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(execute).not.toHaveBeenCalled(); expect(session.active).toBe(true); expect(session.acceptingText).toBe(true);
    expect(session.sendText("Another request")).toBe(true);
    session.dispose();
  });

  it("keeps unrelated backend work busy when an older response completes", async () => {
    const { session, channel } = await startText();
    channel.event({ type: "session.delegation.created", delegation: { target: "responses", id: "voice", response_id: "r1" } });
    expect(session.acceptingText).toBe(false);
    const event = (type: string, id: string) => channel.event({ type: "response.event", delegation_id: "voice", event: { type, response: { id } } });
    event("response.created", "r1"); event("response.created", "r2"); event("response.completed", "r1");
    await vi.advanceTimersByTimeAsync(0); expect(session.acceptingText).toBe(false);
    event("response.completed", "r2"); await vi.advanceTimersByTimeAsync(0); expect(session.acceptingText).toBe(true);
    session.dispose();
  });

  it.each([1, 2])("returns false and keeps the caller draft when send %s fails", async failingSend => {
    const { session, channel, transcript, state } = await startText();
    const original = channel.send.bind(channel); let count = 0;
    vi.spyOn(channel, "send").mockImplementation(text => { if (++count === failingSend) throw Error("synthetic failure"); original(text); });
    let draft = "Keep this exact draft";
    if (session.sendText(draft)) draft = "";
    expect(draft).toBe("Keep this exact draft"); expect(transcript).not.toHaveBeenCalled();
    expect(session.active).toBe(false); expect(state.mock.calls.at(-1)?.[1]).toContain("draft was kept");
    expect(session.sendText(draft)).toBe(false); // No duplicate retry into partially queued conversation.
  });

  it("rejects sends on closed transport without claiming success", async () => {
    const { session, channel, transcript } = await startText();
    channel.readyState = "closed";
    expect(session.sendText("Keep me")).toBe(false); expect(transcript).not.toHaveBeenCalled(); session.dispose();
  });

  it("primes silent audio synchronously before key lookup and reuses it without microphone access", async () => {
    const { session: unused } = await startText(); unused.dispose(); mocks.request.mockClear();
    const { session } = setup();
    const construct = vi.fn(); const resume = vi.fn(async () => {}); const stop = vi.fn();
    vi.stubGlobal("AudioContext", class {
      state = "running";
      constructor() { construct(); }
      createMediaStreamDestination() { const track = { stop }; return { stream: { getTracks: () => [track], getAudioTracks: () => [track] } }; }
      createOscillator() { return { connect() {}, start() {}, stop() {} }; }
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      resume = resume; async close() {}
    });
    session.prepareTextInput();
    expect(resume).toHaveBeenCalledTimes(1); expect(mocks.request).not.toHaveBeenCalled();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    await Promise.resolve(); // Represents asynchronous saved-key lookup.
    await session.start("fixture", "backend", "", "text");
    expect(construct).toHaveBeenCalledTimes(1); expect(resume).toHaveBeenCalledTimes(1);
    session.dispose(); expect(stop).toHaveBeenCalled();
  });

});


it("exposes only scoped read tools for an objective chat, leaving global Talk to Vault unchanged", () => {
  const scoped = liveRequest("offer", "backend", "data", true).session;
  expect(scoped.delegation.responses.tools.map(tool => tool.name)).toEqual([
    "read_current_objective", "list_objective_files", "read_objective_file"
  ]);
  expect(scoped.delegation.responses.instructions).toContain("untrusted");
  expect(liveRequest("offer", "backend", "data").session.delegation.responses.tools.map(tool => tool.name)).toContain("change_task");
});
