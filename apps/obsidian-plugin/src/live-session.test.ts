import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("obsidian", () => ({ requestUrl: mocks.request }));
import { DashboardLiveSession, liveRequest } from "./live-session";

class Channel extends EventTarget {
  readyState = "open"; sent: any[] = [];
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = "closed"; }
  event(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })); }
}
class Peer extends EventTarget {
  static last: Peer;
  channel = new Channel(); iceGatheringState = "complete"; connectionState = "new";
  localDescription = { sdp: "test-offer" }; closed = false;
  constructor() { super(); Peer.last = this; }
  addTrack() {} createDataChannel() { return this.channel; }
  async createOffer() { return { sdp: "test-offer" }; }
  async setLocalDescription() {} async setRemoteDescription() {}
  close() { this.closed = true; }
}
describe("Live connection lifecycle", () => {
  beforeEach(() => { vi.stubGlobal("RTCPeerConnection", Peer); mocks.request.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const setup = () => {
    const track = { stop: vi.fn(), enabled: true };
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
    channel.event({ type: "session.started" }); expect(session.active).toBe(true);
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
    expect(state.mock.calls.at(-1)).toEqual(["connected", "Ready — start speaking. Press play below to hear replies."]);
    session.dispose();
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
});
