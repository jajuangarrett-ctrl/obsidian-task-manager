import { describe, expect, it } from "vitest";
import { createTaskRecord } from "@fjg/task-core";
import { queryTaskContext, QueryableProject, QueryableTask } from "./task-query";

const now = new Date(2026, 7, 12, 12, 0, 0);

function task(input: Partial<QueryableTask["record"]> & Pick<QueryableTask["record"], "task_id" | "title">, options: {
  notes?: string;
  updateText?: string;
  updateDate?: string;
  archived?: boolean;
} = {}): QueryableTask {
  const record = createTaskRecord({
    taskId: input.task_id,
    title: input.title,
    status: input.status || "inbox",
    priority: input.priority,
    due: input.due,
    project: input.project,
    delegatedTo: input.delegated_to,
    tags: ["task"],
    createdAt: input.created_at || "2026-08-01T10:00:00.000Z",
    updatedAt: input.updated_at || "2026-08-01T10:00:00.000Z"
  });
  return {
    record,
    notes: options.notes || "",
    updates: options.updateText ? [{
      timestamp: options.updateDate || "2026-08-11 09:00",
      actor: "Franklin",
      type: "update",
      text: options.updateText
    }] : [],
    taskPath: `08 Tasks/Projects/${record.project}/Tasks/${record.title}/task.md`,
    updatesPath: `08 Tasks/Projects/${record.project}/Updates/${record.title}/updates.md`,
    projectPath: record.project ? `08 Tasks/Projects/${record.project}/project.md` : "",
    archived: options.archived || false
  };
}

const projects: QueryableProject[] = [
  { name: "Summer VAR", status: "active", notes: "Complete the summer reporting cycle.", path: "08 Tasks/Projects/Summer VAR/project.md" },
  { name: "Basic Needs", status: "active", notes: "Coordinate student basic-needs services.", path: "08 Tasks/Projects/Basic Needs/project.md" }
];

const tasks = [
  task({
    task_id: "tsk_var",
    title: "Submit Summer 2026 VAR data",
    status: "do-first",
    due: "2026-08-14",
    project: "Summer VAR",
    updated_at: "2026-08-11T17:00:00.000Z"
  }, { notes: "Confirm MIS totals before submission.", updateText: "PRIE delivered the final enrollment extract." }),
  task({
    task_id: "tsk_retreat",
    title: "Plan Basic Needs retreat",
    status: "waiting",
    due: "2026-08-10",
    project: "Basic Needs",
    updated_at: "2026-08-10T17:00:00.000Z"
  }, { notes: "Waiting for a venue quote.", updateText: "Facilities expects to respond Friday." }),
  task({
    task_id: "tsk_old",
    title: "Old archived budget task",
    status: "archived",
    project: "Basic Needs"
  }, { notes: "Historical record.", archived: true })
];

describe("queryTaskContext", () => {
  it("searches titles, notes, projects, fields, and update history", () => {
    const byNotes = queryTaskContext(tasks, projects, "MIS totals", now);
    expect(byNotes.tasks.map((item) => item.task_id)).toEqual(["tsk_var"]);
    expect(byNotes.tasks[0]).toMatchObject({
      title: "Submit Summer 2026 VAR data",
      due: "2026-08-14",
      project: "Summer VAR",
      update_count: 1,
      links: { task: expect.stringContaining("task.md"), updates: expect.stringContaining("updates.md") }
    });

    const byHistory = queryTaskContext(tasks, projects, "Facilities respond Friday", now);
    expect(byHistory.tasks.map((item) => item.task_id)).toEqual(["tsk_retreat"]);
    expect(byHistory.tasks[0].updates[0].text).toContain("Facilities");
  });

  it("returns a grounded weekly project status with attention tasks", () => {
    const utcBoundaryTask = task({
      task_id: "tsk_boundary",
      title: "Late Sunday project update",
      status: "ongoing",
      project: "Summer VAR",
      updated_at: "2026-08-17T03:30:00.000Z"
    });
    const result = queryTaskContext([...tasks, utcBoundaryTask], projects, "What is the status of my projects this week?", now);
    expect(result.mode).toBe("weekly-project-status");
    expect(result.week).toEqual({ start: "2026-08-10", end: "2026-08-16" });
    expect(result.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Summer VAR", due_this_week: 1, updated_this_week: 2 }),
      expect.objectContaining({ name: "Basic Needs", overdue_tasks: 1 })
    ]));
    expect(result.tasks.map((item) => item.task_id)).toEqual(expect.arrayContaining(["tsk_var", "tsk_retreat", "tsk_boundary"]));
    expect(result.tasks.map((item) => item.task_id)).not.toContain("tsk_old");
  });

  it("reports an explicit no-result state without fallback data", () => {
    const result = queryTaskContext(tasks, projects, "quantum aquarium permits", now);
    expect(result).toMatchObject({ count: 0, no_results: true, projects: [], tasks: [] });
    expect(result.message).toContain("No Task Manager tasks matched");
  });
});
