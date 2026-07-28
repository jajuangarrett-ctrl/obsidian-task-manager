import { describe, expect, test } from "vitest";
import {
  createCreatePayload,
  createUpdatePayload,
  decodeProtocolPayload,
  encodeProtocolPayload,
  normalizeProtocolPayload
} from "./index";

describe("task clipper protocol", () => {
  test("round trips a version 3 create payload", () => {
    const payload = createCreatePayload([
      {
        title: "Review packet",
        details: "Selected text",
        status: "do-first",
        tags: ["task", "DoFirst"]
      }
    ], { requestId: "req_test", createdAt: "2026-07-27T16:00:00.000Z" });
    const decoded = decodeProtocolPayload(encodeProtocolPayload(payload));
    expect(decoded).toEqual(payload);
    if (decoded.action === "create-tasks") expect(decoded.items[0].tags).toEqual(["task"]);
  });

  test("requires an explicitly selected task for updates", () => {
    expect(() => createUpdatePayload({ taskId: "", updateText: "Update" })).toThrow(/task ID/i);
  });

  test("normalizes version 2 create payloads", () => {
    const payload = normalizeProtocolPayload({
      version: 2,
      action: "create-task-note",
      title: "Legacy task",
      details: "Legacy details",
      status: "DoSoon",
      tags: ["task", "DoSoon"],
      createdAt: "2026-07-27T16:00:00.000Z"
    });
    expect(payload.protocol_version).toBe(3);
    expect(payload.action).toBe("create-tasks");
    if (payload.action === "create-tasks") {
      expect(payload.items[0].status).toBe("do-soon");
      expect(payload.items[0].tags).toEqual(["task"]);
    }
  });
});
