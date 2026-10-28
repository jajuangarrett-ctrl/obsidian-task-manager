import { describe, expect, it } from "vitest";
import type { TaskRecord, TaskStatus } from "@fjg/task-core";
import {
  ALL_PROJECTS,
  canArchiveProject,
  countTasksForView,
  groupTasksForKanban,
  isDueOrOverdue,
  matchesProject,
  mostRecentlyModifiedTasks,
  kanbanMoveTarget,
  NO_PROJECT,
  projectSelectionAfterArchive,
  summarizeProjects,
  TASK_VIEWS,
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
    related_files: [],
    subtasks: [],
    tags: ["task"],
    ...overrides
  };
}

describe("dashboard task views", () => {
  it("puts Recent Tasks first and returns at most 30 newest tasks", () => {
    const records = Array.from({ length: 31 }, (_, index) => task({
      task_id: `task-${String(index).padStart(2, "0")}`,
      title: `Task ${String(index).padStart(2, "0")}`,
      updated_at: `2026-07-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`
    }));
    const recent = mostRecentlyModifiedTasks(records.map((record) => ({ record })));

    expect(TASK_VIEWS[0]).toMatchObject({ key: "recent", label: "Recent Objectives" });
    expect(recent).toHaveLength(30);
    expect(recent[0].record.task_id).toBe("task-30");
    expect(recent.at(-1)?.record.task_id).toBe("task-01");
  });

  it("uses the canonical task file modification time when update metadata is invalid", () => {
    const recent = mostRecentlyModifiedTasks([
      { record: task({ task_id: "old", updated_at: "not a timestamp" }), modifiedAt: 100 },
      { record: task({ task_id: "new", updated_at: "not a timestamp" }), modifiedAt: 200 }
    ]);

    expect(recent.map((item) => item.record.task_id)).toEqual(["new", "old"]);
  });

  it("keeps completed and archived work out of All Open", () => {
    const records = [
      task({ task_id: "open", status: "do-first" }),
      task({ task_id: "done", status: "completed" }),
      task({ task_id: "archived", status: "archived" })
    ];
    expect(countTasksForView(records, "all-open")).toBe(1);
    expect(taskMatchesView(records[1], "completed")).toBe(true);
    expect(countTasksForView(records, "archived")).toBe(2);
  });

  it("keeps explicitly assigned Inbox tasks in the Inbox view", () => {
    expect(taskMatchesView(task({ status: "inbox" }), "inbox")).toBe(true);
    expect(taskMatchesView(task({ status: "inbox" }), "inbox", "2026-07-27", false)).toBe(false);
    expect(TASK_VIEWS.map((view) => view.key)).toContain("inbox");
    expect(TASK_VIEWS.map((view) => view.key)).not.toContain("unassigned");
    expect(TASK_VIEWS.map((view) => view.key)).toContain("completed");
    expect(TASK_VIEWS.map((view) => view.key)).not.toContain("archived");
  });

  it("filters the Inbox folder by location, independently of tags and status", () => {
    const assigned = task({status:"inbox",project:"CalWORKs"});
    const untagged = task({status:"do-soon",project:""});
    for (const record of [assigned, untagged, task({status:"completed"}), task({status:"archived"})]) {
      expect(taskMatchesView(record,"no-project",undefined,true,"08 Tasks/Inbox/Files/Nested/Objective/task.md")).toBe(true);
      expect(taskMatchesView(record,"no-project",undefined,true,"02 Programs/Veterans/Veterans Tasks/Objective/task.md")).toBe(false);
    }
    for(const path of ["08 Tasks/Inbox-old/Test/task.md","08 Tasks/Inbox2/Test/task.md","08 Tasks/Inbox/../../Elsewhere/Test/task.md", ""]) {
      expect(taskMatchesView(untagged,"no-project",undefined,true,path)).toBe(false);
    }
    expect(taskMatchesView(assigned,"no-project",undefined,true,"08 Tasks\\Inbox\\Files\\Test\\task.md")).toBe(true);
    expect(taskMatchesView(assigned,"no-project",undefined,true,"08 Tasks//Inbox/./Files/Test/task.md")).toBe(true);
    expect(taskMatchesView(assigned,"inbox",undefined,true,"02 Programs/Veterans/Tasks/Test/task.md")).toBe(true);
    expect(taskMatchesView(untagged,"all-open",undefined,true,"02 Programs/Veterans/Tasks/Test/task.md")).toBe(true);
  });

  it("shows legacy archived tasks in Completed", () => {
    const archived = task({ task_id: "archived", status: "archived", project: "Finished" });

    for (const view of TASK_VIEWS.filter((candidate) => candidate.key !== "completed")) {
      expect(taskMatchesView(archived, view.key)).toBe(false);
    }
    expect(taskMatchesView(archived, "archived")).toBe(true);
    expect(countTasksForView([archived], "all-open")).toBe(0);
    expect(countTasksForView([archived], "archived")).toBe(1);
  });

  it("counts only open tasks due today or earlier", () => {
    expect(isDueOrOverdue(task({ due: "2026-07-27" }), "2026-07-27")).toBe(true);
    expect(isDueOrOverdue(task({ due: "2026-07-28" }), "2026-07-27")).toBe(false);
    expect(isDueOrOverdue(task({ due: "2026-07-20", status: "completed" }), "2026-07-27")).toBe(false);
  });

  it.each<Exclude<TaskStatus, "archived">>(["inbox", "do-first", "do-soon", "ongoing", "delegate", "waiting", "on-hold", "completed"])(
    "matches the %s status view",
    (status) => {
      expect(taskMatchesView(task({ status }), status)).toBe(true);
    }
  );

  it("includes an Ongoing dashboard view", () => {
    expect(TASK_VIEWS).toContainEqual({ key: "ongoing", label: "Ongoing", icon: "play-circle" });
  });

  it("places No Project directly before Completed without restoring Unassigned", () => {
    const keys = TASK_VIEWS.map((view) => view.key);
    expect(TASK_VIEWS[keys.indexOf("no-project")]).toMatchObject({ label: "Inbox folder" });
    expect(keys.indexOf("no-project")).toBe(keys.indexOf("completed") - 1);
    expect(keys).not.toContain("unassigned");
  });

  it("omits Archived from Kanban without changing archived records", () => {
    const statuses: TaskStatus[] = [
      "inbox", "do-first", "do-soon", "ongoing", "delegate", "waiting", "on-hold", "completed", "archived"
    ];
    const tasks = statuses.map((status) => ({ record: task({ task_id: status, status }) }));
    const columns = groupTasksForKanban(tasks);

    expect(columns.map((column) => column.status)).toEqual(statuses.filter(status => status !== "archived"));
    expect(columns.flatMap((column) => column.tasks)).toHaveLength(tasks.length - 1);
    expect(tasks.at(-1)?.record.status).toBe("archived");
    expect(columns.every((column) => column.tasks.length === 1)).toBe(true);
  });

  it("accepts valid Kanban moves and ignores invalid or no-op drops", () => {
    expect(kanbanMoveTarget("inbox", "waiting")).toBe("waiting");
    expect(kanbanMoveTarget("inbox", "inbox")).toBeNull();
    expect(kanbanMoveTarget("inbox", "not-a-status")).toBeNull();
  });
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

  it("clears only the project scope that was archived", () => {
    expect(projectSelectionAfterArchive("2026 Coworkers Retreat", "2026 Coworkers Retreat"))
      .toBe(ALL_PROJECTS);
    expect(projectSelectionAfterArchive("2026 coworkers retreat", "2026 Coworkers Retreat"))
      .toBe(ALL_PROJECTS);
    expect(projectSelectionAfterArchive("CalWORKs", "2026 Coworkers Retreat"))
      .toBe("CalWORKs");
    expect(projectSelectionAfterArchive(ALL_PROJECTS, "2026 Coworkers Retreat"))
      .toBe(ALL_PROJECTS);
    expect(projectSelectionAfterArchive(NO_PROJECT, "2026 Coworkers Retreat"))
      .toBe(NO_PROJECT);
  });

  it("keeps registered projects visible before they have tasks", () => {
    expect(summarizeProjects(records, ["Basic Needs", "New Project"])).toEqual([
      { key: "Basic Needs", name: "Basic Needs", openCount: 1, totalCount: 2 },
      { key: "CalWORKs", name: "CalWORKs", openCount: 1, totalCount: 1 },
      { key: "New Project", name: "New Project", openCount: 0, totalCount: 0 },
      { key: NO_PROJECT, name: "No project", openCount: 1, totalCount: 1 }
    ]);
  });

  it("only permits named projects with zero open tasks to be archived", () => {
    expect(canArchiveProject({ key: "Finished", name: "Finished", openCount: 0, totalCount: 3 })).toBe(true);
    expect(canArchiveProject({ key: "Active", name: "Active", openCount: 1, totalCount: 3 })).toBe(false);
    expect(canArchiveProject({ key: NO_PROJECT, name: "No project", openCount: 0, totalCount: 3 })).toBe(false);
  });
});

it("offers exactly one Completed tab and filters it to closed objectives", () => {
  expect(TASK_VIEWS.filter(view => view.key === "completed")).toHaveLength(1);
  expect(TASK_VIEWS.some(view => /archiv/i.test(view.label))).toBe(false);
  expect(taskMatchesView(task({status:"completed"}),"completed")).toBe(true);
  expect(taskMatchesView(task({status:"inbox"}),"completed")).toBe(false);
});
