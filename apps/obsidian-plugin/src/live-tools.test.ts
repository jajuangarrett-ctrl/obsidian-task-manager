import { describe, expect, it, vi } from "vitest";
import { LiveToolLoop } from "./live-tools";

function envelope(type: string, extra: Record<string, unknown> = {}) {
  return { type: "response.event", delegation_id: "delegation-1", event: { type, ...extra } };
}
const call = (id: string) => ({ type: "function_call", call_id: id, name: "change_task", arguments: "{}" });

describe("Live Responses function execution", () => {
  it("collects completed function items and returns all results before continuing an empty terminal snapshot", async () => {
    const send = vi.fn(); const execute = vi.fn(async () => ({ saved: true }));
    const loop = new LiveToolLoop(execute, send);
    await loop.handle(envelope("response.created", { response: { id: "r1" } }));
    await loop.handle(envelope("response.output_item.done", { item: call("a") }));
    await loop.handle(envelope("response.output_item.done", { item: call("b") }));
    expect(execute).not.toHaveBeenCalled();
    await loop.handle(envelope("response.completed", { response: { id: "r1", output: [] } }));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([event]) => event.type)).toEqual(["response.item.create", "response.item.create", "response.create"]);
  });
  it("does not repeat writes for duplicate function or completion events", async () => {
    const execute = vi.fn(async () => ({ saved: true })); const send = vi.fn();
    const loop = new LiveToolLoop(execute, send);
    for (const id of ["r1", "r2"]) {
      await loop.handle(envelope("response.created", { response: { id } }));
      await loop.handle(envelope("response.output_item.done", { item: call("same") }));
      await loop.handle(envelope("response.output_item.done", { item: call("same") }));
      await loop.handle(envelope("response.completed", { response: { id } }));
      await loop.handle(envelope("response.completed", { response: { id } }));
    }
    expect(execute).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(4);
  });
  it("does not execute cancelled responses, incomplete arguments, or stopped sessions", async () => {
    const execute = vi.fn(); const loop = new LiveToolLoop(execute, vi.fn());
    await loop.handle(envelope("response.created", { response: { id: "r1" } }));
    await loop.handle(envelope("response.function_call_arguments.done", { arguments: "{}" }));
    await loop.handle(envelope("response.output_item.done", { item: call("a") }));
    await loop.handle(envelope("response.cancelled", { response: { id: "r1" } }));
    await loop.handle(envelope("response.completed", { response: { id: "r1" } }));
    loop.stop();
    await loop.handle(envelope("response.created", { response: { id: "r2" } }));
    await loop.handle(envelope("response.output_item.done", { item: call("b") }));
    await loop.handle(envelope("response.completed", { response: { id: "r2" } }));
    expect(execute).not.toHaveBeenCalled();
  });
  it("returns tool failures without reporting a save and stops subsequent writes during shutdown", async () => {
    const send = vi.fn(); const execute = vi.fn(async () => { throw new Error("Task changed since read"); });
    const loop = new LiveToolLoop(execute, send);
    await loop.handle(envelope("response.created", { response: { id: "r1" } }));
    await loop.handle(envelope("response.output_item.done", { item: call("a") }));
    await loop.handle(envelope("response.completed", { response: { id: "r1" } }));
    expect(JSON.parse(send.mock.calls[0][0].item.output)).toEqual({ error: "Task changed since read" });
    const stopped = new LiveToolLoop(async () => { stopped.stop(); return { saved: true }; }, send);
    await stopped.handle(envelope("response.created", { response: { id: "r2" } }));
    await stopped.handle(envelope("response.output_item.done", { item: call("b") }));
    await stopped.handle(envelope("response.completed", { response: { id: "r2" } }));
    expect(send).toHaveBeenCalledTimes(2);
  });
});
