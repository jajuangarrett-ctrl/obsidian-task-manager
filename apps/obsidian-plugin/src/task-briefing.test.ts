import { describe, expect, it } from "vitest";
import { createTaskRecord } from "@fjg/task-core";
import { renderTaskManagerBriefing, TASK_BRIEFING_TYPE } from "./task-briefing";
import type { QueryableProject, QueryableTask } from "./task-query";

const task: QueryableTask = {
  record: createTaskRecord({
    taskId: "tsk_briefing",
    title: "Prepare weekly enrollment report",
    details: "",
    status: "waiting",
    due: "2026-08-21",
    project: "Enrollment",
    delegatedTo: "Dara",
    createdAt: "2026-08-10T16:00:00.000Z",
    updatedAt: "2026-08-15T16:00:00.000Z"
  }),
  notes: "# Prepare weekly enrollment report\n\nConfirm the MIS totals with PRIE.",
  updates: [{
    timestamp: "2026-08-15 09:00",
    actor: "Franklin",
    type: "update",
    text: "PRIE sent the corrected enrollment extract."
  }],
  taskPath: "08 Tasks/Projects/Enrollment/Tasks/Prepare weekly enrollment report/task.md",
  updatesPath: "08 Tasks/Projects/Enrollment/Updates/Prepare weekly enrollment report/updates.md",
  projectPath: "08 Tasks/Projects/Enrollment/project.md",
  archived: false
};

const project: QueryableProject = {
  name: "Enrollment",
  status: "active",
  notes: "Coordinate enrollment reporting.",
  path: "08 Tasks/Projects/Enrollment/project.md"
};

describe("Task Manager briefing", () => {
  it("renders every required task field, full notes, recent history, and source links", () => {
    const markdown = renderTaskManagerBriefing([task], [project], new Date("2026-08-16T20:00:00.000Z"));
    expect(markdown).toContain(`type: ${TASK_BRIEFING_TYPE}`);
    expect(markdown).toContain("task_count: 1");
    expect(markdown).toContain("Prepare weekly enrollment report");
    expect(markdown).toContain("Status: **Waiting**");
    expect(markdown).toContain("Due date: 2026-08-21");
    expect(markdown).toContain("Delegated to: Dara");
    expect(markdown).toContain("Confirm the MIS totals with PRIE.");
    expect(markdown).toContain("PRIE sent the corrected enrollment extract.");
    expect(markdown).toContain("[[08 Tasks/Projects/Enrollment/Tasks/Prepare weekly enrollment report/task|Prepare weekly enrollment report]]");
    expect(markdown).toContain("[[08 Tasks/Projects/Enrollment/Updates/Prepare weekly enrollment report/updates|Prepare weekly enrollment report updates]]");
    expect(markdown).toContain("[[08 Tasks/Projects/Enrollment/project|Enrollment]]");
  });

  it("includes registered projects with no tasks and a clear empty state", () => {
    const projectOnly = renderTaskManagerBriefing([], [project], new Date("2026-08-16T20:00:00.000Z"));
    expect(projectOnly).toContain("_No tasks are currently assigned to this project._");
    const empty = renderTaskManagerBriefing([], [], new Date("2026-08-16T20:00:00.000Z"));
    expect(empty).toContain("No tasks or projects are currently indexed by FJG Task Manager.");
    expect(empty).toContain("task_count: 0");
  });
});
