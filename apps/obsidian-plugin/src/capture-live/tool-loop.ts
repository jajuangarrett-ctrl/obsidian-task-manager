// Shared Live Responses protocol, adapted from FJG Objective Manager 0.17.0.
type Event = Record<string, any>;
/** Tracks completed function items, not empty lifecycle snapshots. Serializes writes and deduplicates call IDs. */
export class LiveToolLoop {
  private responses = new Map<string, { calls: Event[]; finished: boolean }>();
  private current = new Map<string, string>();
  private results = new Map<string, Promise<unknown>>();
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;
  constructor(private execute: (name: string, args: string, id: string) => Promise<unknown>, private send: (event: Event) => void) {}
  stop(): void { this.stopped = true; }
  handle(envelope: Event): Promise<void> {
    this.chain = this.chain.then(() => this.process(envelope));
    return this.chain;
  }
  private async process(envelope: Event): Promise<void> {
    if (this.stopped || envelope.type !== "response.event") return;
    const event = envelope.event;
    const delegation = envelope.delegation_id;
    if (!event || typeof delegation !== "string") return;
    if (event.type === "response.created") {
      const id = event.response?.id;
      if (typeof id === "string") {
        this.current.set(delegation, id);
        if (!this.responses.has(id)) this.responses.set(id, { calls: [], finished: false });
      }
      return;
    }
    const id = event.response?.id || this.current.get(delegation);
    const state = this.responses.get(id);
    if (!state || state.finished) return;
    if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
      if (!state.calls.some((call) => call.call_id === event.item.call_id)) state.calls.push(event.item);
    }
    if (["response.failed", "response.cancelled", "response.incomplete"].includes(event.type)) { state.finished = true; return; }
    if (event.type !== "response.completed") return;
    state.finished = true;
    for (const call of state.calls) {
      if (this.stopped) return;
      if (typeof call.call_id !== "string" || typeof call.name !== "string" || typeof call.arguments !== "string") throw new Error("Invalid voice tool call.");
      let result = this.results.get(call.call_id);
      if (!result) {
        result = this.execute(call.name, call.arguments, call.call_id).catch((error) => ({ error: error instanceof Error ? error.message : "Task change failed." }));
        this.results.set(call.call_id, result);
      }
      const output = await result;
      if (this.stopped) return;
      this.send({ type: "response.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) } });
    }
    if (state.calls.length && !this.stopped) this.send({ type: "response.create" });
  }
}
