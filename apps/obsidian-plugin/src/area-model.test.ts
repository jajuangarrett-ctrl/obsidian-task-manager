import { describe, expect, it } from "vitest";
import { filterAreaObjectives, NO_AREA, objectiveAreaPath, objectiveAreas } from "./area-model";
import type { IndexedTask } from "./workspace-service";

const basic = "02 Programs/Basic-Needs/Basic Needs Tasks";
const admin = "03 Areas/Admin-leadership/Admin leadership Tasks";
const task = (path: string, title = "Review", status = "do-first", archived = false) => ({
  taskFile: { path: `${path}/Objective/task.md` },
  record: { task_id: path, title, status, tags: ["unrelated"] }, archived
}) as IndexedTask;

describe("folder-based areas", () => {
  it("discovers named Task/Tasks collections, including empty and singular folders", () => {
    const empty = "03 Areas/Career/Career Task";
    expect(objectiveAreas([basic, admin, empty, "08 Tasks", "02 Programs/Basic-Needs/Tasks", "03 Areas/Taskforce", `${basic}/Files/Reference Tasks`, "Artifacts/Old Tasks", "03 Areas/Archive/Old Tasks"], []).map(area => area.path).sort())
      .toEqual([basic, admin, empty].sort());
  });

  it("filters by actual folder instead of tags, excludes archives, and retains completed objectives", () => {
    const tasks = [task(basic, "Budget"), task(admin, "Budget"), task(basic, "Completed", "completed"), task(basic, "Old", "archived"), task(basic, "Archived", "do-first", true)];
    const before = JSON.stringify(tasks);
    const areas = objectiveAreas([basic, admin], tasks);
    expect(filterAreaObjectives(tasks, areas, basic, "").map(t => t.record.title)).toEqual(["Budget", "Completed"]);
    expect(filterAreaObjectives(tasks, areas, basic, " BUDGET ")).toEqual([tasks[0]]);
    expect(areas.find(a => a.path === basic)?.count).toBe(2);
    expect(JSON.stringify(tasks)).toBe(before);
  });

  it("uses nearest matching collection, distinguishes duplicate names and respects path boundaries", () => {
    const child = `${basic}/Special/Special Tasks`;
    const duplicate = "03 Areas/Other/Basic Needs Tasks";
    const tasks = [task(child), task(`${basic} Other`)];
    const areas = objectiveAreas([basic, child, duplicate], tasks);
    expect(objectiveAreaPath(tasks[0], areas)).toBe(child);
    expect(objectiveAreaPath(tasks[1], areas)).toBe(NO_AREA);
    expect(areas.find(a => a.path === basic)?.label).toContain("02 Programs/Basic-Needs");
    expect(areas.find(a => a.path === duplicate)?.label).toContain("03 Areas/Other");
  });

  it("recomputes choices and membership after folder creation, rename and objective moves", () => {
    const tasks = [task(basic)];
    expect(objectiveAreas([basic], tasks)).toHaveLength(1);
    expect(objectiveAreas([basic, admin], tasks).find(a => a.path === admin)?.count).toBe(0);
    tasks[0] = task(admin);
    const areas = objectiveAreas([admin], tasks);
    expect(areas.map(a => [a.path, a.count])).toEqual([[admin, 1]]);
    expect(filterAreaObjectives(tasks, areas, admin, "missing")).toEqual([]);
  });

  it("does not mistake objective workspace names for collection folders; keeps unfiled objectives accessible", () => {
    const workspace = `${basic}/Review Tasks`;
    const tasks = [{ ...task(basic), taskFile: { path: `${workspace}/task.md` } } as IndexedTask, task("08 Tasks/Inbox/Tasks")];
    const areas = objectiveAreas([basic, workspace], tasks);
    expect(areas.map(a => a.path)).toEqual([basic]);
    expect(filterAreaObjectives(tasks, areas, NO_AREA, "")).toEqual([tasks[1]]);
    expect(filterAreaObjectives(tasks, areas, "", "")).toEqual(tasks);
  });
});
