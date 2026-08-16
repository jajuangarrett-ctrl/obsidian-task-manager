import { describe, expect, it } from "vitest";
import type { CatalogTask } from "@fjg/task-protocol";
import { filterTaskUpdateOptions } from "./task-update-capture-model";

const tasks: CatalogTask[] = [
  {
    task_id: "01TASKB",
    title: "Prepare Basic Needs update",
    status: "ongoing",
    project: "Basic Needs",
    delegated_to: "",
    path: "08 Tasks/Prepare Basic Needs update",
    archived: false
  },
  {
    task_id: "01TASKA",
    title: "Adobe signature follow-up",
    status: "do-first",
    project: "Contracts",
    delegated_to: "Franklin",
    path: "08 Tasks/Adobe signature follow-up",
    archived: false
  },
  {
    task_id: "01TASKC",
    title: "Archived Adobe request",
    status: "archived",
    project: "Contracts",
    delegated_to: "",
    path: "08 Tasks/Archive/Archived Adobe request",
    archived: true
  }
];

describe("task update capture model", () => {
  it("searches task metadata and keeps active tasks before archived tasks", () => {
    expect(filterTaskUpdateOptions(tasks, "adobe").map((task) => task.task_id)).toEqual(["01TASKA", "01TASKC"]);
    expect(filterTaskUpdateOptions(tasks, "basic needs").map((task) => task.task_id)).toEqual(["01TASKB"]);
  });

  it("puts an exact stable ID match first and respects the result limit", () => {
    expect(filterTaskUpdateOptions(tasks, "01TASKC", 1).map((task) => task.task_id)).toEqual(["01TASKC"]);
    expect(filterTaskUpdateOptions(tasks, "", 2)).toHaveLength(2);
  });
});
