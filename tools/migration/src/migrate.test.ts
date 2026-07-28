import { describe, expect, test } from "vitest";
import { planLegacyMigration } from "./migrate";

describe("legacy migration", () => {
  test("maps stable fields and preserves updates", () => {
    const [item] = planLegacyMigration([{
      id: "FJG-1234",
      title: "Review packet",
      bucket: "DoFirst",
      urgent: true,
      project: "Basic Needs",
      assignee: "Amanda",
      dueDate: "2026-08-01",
      tags: ["task", "DoFirst", "legacy-tag"],
      createdAt: "2026-07-01T16:00:00.000Z",
      updates: [{ id: "u1", text: "Packet received.", createdAt: "2026-07-02T16:00:00.000Z" }]
    }], { now: new Date("2026-07-27T16:00:00.000Z") });
    expect(item.record?.task_id).toBe("FJG-1234");
    expect(item.record?.status).toBe("do-first");
    expect(item.record?.tags).toEqual(["task"]);
    expect(item.record?.delegated_to).toBe("Amanda");
    expect(item.updatesMarkdown).toContain("Packet received.");
    expect(item.legacyTags).toEqual(["DoFirst", "legacy-tag"]);
  });

  test("maps cancelled to archived and skips deleted tasks", () => {
    const items = planLegacyMigration([
      { id: "one", title: "Cancelled", bucket: "Cancelled" },
      { id: "two", title: "Deleted", deletedAt: "2026-07-01T00:00:00Z" }
    ], { now: new Date("2026-07-27T16:00:00.000Z") });
    expect(items[0].record?.status).toBe("archived");
    expect(items[0].destination).toContain("08 Tasks/Archive");
    expect(items[1].action).toBe("skip");
  });
});
