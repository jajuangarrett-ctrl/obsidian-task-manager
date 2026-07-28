import { describe, expect, test } from "vitest";
import { parseProjectMarkdown } from "@fjg/task-core";
import { planLegacyMigration, planLegacyProjectMigration } from "./migrate";

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

  test("uses readable collision-safe task folders without exposing task IDs", () => {
    const items = planLegacyMigration([
      { id: "legacy-one", title: "Repeated title", bucket: "DoFirst" },
      { id: "legacy-two", title: "Repeated title", bucket: "DoSoon" }
    ]);
    expect(items[0].destination).toBe("08 Tasks/Workspaces/Repeated title");
    expect(items[1].destination).toBe("08 Tasks/Workspaces/Repeated title (2)");
    expect(items[0].destination).not.toContain("legacy-one");
  });

  test("stages managed and task-referenced project workspaces", () => {
    const items = planLegacyProjectMigration(
      ["Basic Needs", "Empty Project"],
      [
        { id: "one", title: "Managed", project: "Basic Needs" },
        { id: "two", title: "Derived", project: "Taskboard Diagnostics" }
      ],
      { createdAt: "2026-07-27T23:52:03.011Z" }
    );
    expect(items.map((item) => [item.name, item.source, item.action])).toEqual([
      ["Basic Needs", "managed-list", "import"],
      ["Empty Project", "managed-list", "import"],
      ["Taskboard Diagnostics", "task-reference", "import"]
    ]);
    expect(items[2].warnings).toContain(
      "Project is referenced by legacy tasks but absent from the managed project list."
    );
    expect(parseProjectMarkdown(items[0].projectMarkdown || "")).toMatchObject({
      name: "Basic Needs",
      status: "active",
      created_at: "2026-07-27T23:52:03.011Z"
    });
  });
});
