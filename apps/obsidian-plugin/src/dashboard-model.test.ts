import { describe, expect, it } from "vitest";
import type { TaskRecord, TaskStatus } from "@fjg/task-core";
import {
  ALL_PROJECTS,
  countTasksForView,
  isDueOrOverdue,
  matchesProject,
  NO_PROJECT,
  summarizeProjects,
  taskMatchesView
} from "./dashboard-model";

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    schema_version: 1,
    task_id: "tsk_test",
    title: "Test task",
    status: "do-first",
    priority: "normal",
    due: "",
    created_at: "2026-07-20T12:00:00.000Z",
    updated_at: "2026-07-20T12:00:00.000Z",
    completed_at: "",
    archived_at: "",
    project: "",
    delegated_to: "",
    source_type: "manual",
    source_title: "",
    source_url: "",
    legacy_ids: [],
    legacy_status: "",
    tags: ["task"],
    ...overrides
  };
}

describe("dashboard task views", () => {
  it("keeps completed and archived work out of All Open", () => {
    const records = [
      task({ task_id: "open", status: "do-first" }),
      task({ task_id: "done", status: "completed" }),
      task({ task_id: "archived", status: "archived" })
    ];
    expect(countTasksForView(records, "all-open")).toBe(1);
    expect(taskMatchesView(records[1], "completed")).toBe(true);
  });

  it("counts only open tasks due today or earlier", () => {
    expect(isDueOrOverdue(task({ due: "2026-07-27" }), "2026-07-27")).toBe(true);
    expect(isDueOrOverdue(task({ due: "2026-07-28" }), "2026-07-27")).toBe(false);
    expect(isDueOrOverdue(task({ due: "2026-07-20", status: "completed" }), "2026-07-27")).toBe(false);
  });

  it.each<Exclude<TaskStatus, "archived">>(["inbox", "do-first", "do-soon", "delegate", "waiting", "on-hold", "completed"])(
    "matches the %s status view",
    (status) => {
      expect(taskMatchesView(task({ status }), status)).toBe(true);
    }
  );
});

describe("dashboard project summaries", () => {
  const records = [
    task({ task_id: "one", project: "Basic Needs", status: "do-first" }),
    task({ task_id: "two", project: "Basic Needs", status: "completed" }),
    task({ task_id: "three", project: "CalWORKs", status: "waiting" }),
    task({ task_id: "four", project: "", status: "do-soon" }),
    task({ task_id: "five", project: "Hidden", status: "archived" })
  ];

  it("reports project open and total counts and places No project last", () => {
    expect(summarizeProjects(records)).toEqual([
      { key: "Basic Needs", name: "Basic Needs", openCount: 1, totalCount: 2 },
      { key: "CalWORKs", name: "CalWORKs", openCount: 1, totalCount: 1 },
      { key: NO_PROJECT, name: "No project", openCount: 1, totalCount: 1 }
    ]);
  });

  it("supports all-project and no-project filters", () => {
    expect(matchesProject(records[0], ALL_PROJECTS)).toBe(true);
    expect(matchesProject(records[3], NO_PROJECT)).toBe(true);
    expect(matchesProject(records[0], "Basic Needs")).toBe(true);
    expect(matchesProject(records[0], "CalWORKs")).toBe(false);
  });
});
