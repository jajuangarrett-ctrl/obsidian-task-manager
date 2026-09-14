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
  notes: "# Prepare weekly enrollment report\n\n## Outcome\n\n\n## Details\n\nConfirm the MIS totals with PRIE.\n\n### Evidence\n\n- [MIS extract](https://example.com/mis)\n\n## Source\n\n\n## Related files\n",
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
  it("renders objectives as linked headings with actions, populated sections, compact metadata, and history", () => {
    const assigned: QueryableTask = {
      ...task,
      record: {
        ...task.record,
        source_type: "web",
        source_title: "Enrollment source",
        source_url: "https://example.com/source",
        related_files: ["08 Tasks/Files/enrollment evidence.pdf"],
        subtasks: [{
          id: "tsk_action",
          title: "Confirm finance totals",
          completed: false,
          status: "do-first",
          due: "2026-08-20",
          notes: "# Confirm finance totals\n\n## Outcome\n\n\n## Details\n\nRetain the attached citation.\n\n## Source\n\n",
          history: "",
          source_task_id: "",
          attachment_folder: "Subtasks/Confirm finance totals"
        }]
      }
    };
    const markdown = renderTaskManagerBriefing([assigned], [project], new Date("2026-08-16T20:00:00.000Z"));
    expect(markdown).toContain(`type: ${TASK_BRIEFING_TYPE}`);
    expect(markdown).toContain("task_count: 1");
    expect(markdown).toContain("Objectives in this briefing: **1**");
    expect(markdown).toContain("### [[08 Tasks/Projects/Enrollment/Tasks/Prepare weekly enrollment report/task|Prepare weekly enrollment report]]");
    expect(markdown).toContain("**Status:** Waiting");
    expect(markdown).toContain("**Due:** Aug 21, 2026");
    expect(markdown).toContain("**Project:** #project/Enrollment");
    expect(markdown).toContain("**Delegated:** Dara");
    expect(markdown).toContain("#### Actions");
    expect(markdown).toContain("**Confirm finance totals** · Do First · Due Aug 20, 2026");
    expect(markdown).toContain("Retain the attached citation.");
    expect(markdown).toContain("#### Details");
    expect(markdown).toContain("Confirm the MIS totals with PRIE.");
    expect(markdown).toContain("##### Evidence");
    expect(markdown).toContain("[MIS extract](https://example.com/mis)");
    expect(markdown).toContain("#### Source");
    expect(markdown).toContain("[Enrollment source](https://example.com/source)");
    expect(markdown).toContain("#### Related files");
    expect(markdown).toContain("[[08 Tasks/Files/enrollment evidence.pdf|enrollment evidence.pdf]]");
    expect(markdown).toContain("#### Recent updates");
    expect(markdown).toContain("PRIE sent the corrected enrollment extract.");
    expect(markdown).toContain("[[08 Tasks/Projects/Enrollment/Updates/Prepare weekly enrollment report/updates|Full update history]]");
    expect(markdown).not.toContain("#### Outcome");
    expect(markdown).not.toContain("**Outcome**");
    expect(markdown).not.toContain("# Prepare weekly enrollment report\n");
  });

  it("omits archived objectives and their actions while retaining completed non-archived objectives", () => {
    const archived: QueryableTask = {
      ...task,
      archived: true,
      record: {
        ...task.record,
        task_id: "tsk_archived",
        title: "Historical enrollment review",
        status: "archived",
        subtasks: [{
          id: "tsk_archived_action",
          title: "Archived action must stay out",
          completed: false,
          status: "do-soon",
          due: "",
          notes: "Archived action notes must stay out.",
          history: "",
          source_task_id: "",
          attachment_folder: "Subtasks/Archived action"
        }]
      },
      notes: "Archived details must stay out.",
      updates: [{ timestamp: "2026-08-15 09:00", actor: "Franklin", type: "archived", text: "Archived history must stay out." }]
    };
    const completed: QueryableTask = {
      ...task,
      record: { ...task.record, task_id: "tsk_completed", title: "Completed enrollment review", status: "completed" }
    };
    const markdown = renderTaskManagerBriefing([archived, task, completed], [project], new Date("2026-08-16T20:00:00.000Z"));
    expect(markdown).toContain("task_count: 2");
    expect(markdown).toContain("Prepare weekly enrollment report");
    expect(markdown).toContain("Completed enrollment review");
    expect(markdown).not.toContain("Historical enrollment review");
    expect(markdown).not.toContain("Archived action must stay out");
    expect(markdown).not.toContain("Archived details must stay out");
    expect(markdown).not.toContain("Archived history must stay out");
    expect(markdown).not.toContain("## Archived objectives");
  });

  it("omits empty templates in objective and action previews without dropping nested content", () => {
    const nested: QueryableTask = {
      ...task,
      updates: [],
      notes: "# Prepare weekly enrollment report\n\n## Outcome\n\n## Details\n\nMeaningful detail.\n\n### Citation\n\n> Quoted evidence with a [[Source note]].\n\n## Source\n\n## Related files\n",
      record: {
        ...task.record,
        subtasks: [{
          id: "tsk_action",
          title: "Review evidence",
          completed: false,
          status: "do-soon",
          due: "",
          notes: "# Review evidence\n\n## Outcome\n\n## Details\n\nKeep this action note.\n\n### Attachment\n\n![[evidence.pdf]]\n\n## Source\n\n## Related files\n",
          history: "",
          source_task_id: "",
          attachment_folder: "Subtasks/Review evidence"
        }]
      }
    };
    const markdown = renderTaskManagerBriefing([nested], [], new Date("2026-08-16T20:00:00.000Z"));
    expect(markdown).toContain("#### Details");
    expect(markdown).toContain("##### Citation");
    expect(markdown).toContain("> Quoted evidence with a [[Source note]].");
    expect(markdown).toContain("Keep this action note.");
    expect(markdown).toContain("![[evidence.pdf]]");
    expect(markdown).not.toContain("#### Outcome");
    expect(markdown).not.toContain("#### Source");
    expect(markdown).not.toContain("#### Related files");
    expect(markdown).not.toContain("Recent updates");
  });

  it("keeps project-only data out of the reading flow and provides a clear empty state", () => {
    const projectOnly = renderTaskManagerBriefing([], [project], new Date("2026-08-16T20:00:00.000Z"));
    expect(projectOnly).toContain("_No non-archived objectives are currently indexed._");
    expect(projectOnly).toContain("Project tags represented in the Objective Manager: **1**");
    expect(projectOnly).not.toContain("### Enrollment");
    const empty = renderTaskManagerBriefing([], [], new Date("2026-08-16T20:00:00.000Z"));
    expect(empty).toContain("_No non-archived objectives are currently indexed._");
    expect(empty).toContain("task_count: 0");
  });
});
