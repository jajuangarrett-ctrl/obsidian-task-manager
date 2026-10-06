import { describe, expect, it } from "vitest";
import { createTaskRecord } from "@fjg/task-core";
import type { IndexedTask } from "./workspace-service";
import { eligibleForMove, filterHomeTasks, homeRowStatuses, matchesHomeScope, nextObjectiveAction } from "./home-model";
function task(title: string, status = "do-first", path = "08 Tasks/Inbox/Tasks/Test/task.md"): IndexedTask {
  return { record: { ...createTaskRecord({ title }), status }, archived: status === "archived", relocatedBundle: false, taskFile: { path, stat: { mtime: 1 } } } as IndexedTask;
}
describe("Home and Move scope", () => {
  it("keeps open, completed and archived scopes exhaustive and distinct", () => {
    const tasks=[task("Open"),task("Complete","completed"),task("Archived","archived")];
    expect(tasks.filter(t=>matchesHomeScope(t.record,"open"))).toHaveLength(1);
    expect(tasks.filter(t=>matchesHomeScope(t.record,"completed"))).toHaveLength(1);
    expect(tasks.filter(t=>matchesHomeScope(t.record,"archived"))).toHaveLength(1);
    expect(tasks.filter(t=>matchesHomeScope(t.record,"all"))).toHaveLength(3);
    expect(homeRowStatuses("all")).toContain("archived");
  });
  it("searches every card and action, including off-screen objectives", () => {
    const tasks=Array.from({length:40},(_,i)=>task(`Objective ${i}`));
    tasks[39].record.subtasks=[{title:"Hidden next step"} as never];
    expect(filterHomeTasks(tasks,"open","Hidden next step","","","updated")).toEqual([tasks[39]]);
  });
  it("sorts stored due dates first without inventing missing dates", () => {
    const a=task("No due date"),b=task("Due");b.record.due="2026-10-05";
    expect(filterHomeTasks([a,b],"open","","","","due")).toEqual([b,a]);
  });
  it("uses actual root boundaries, not status or project metadata, for Move", () => {
    const roots=["08 Tasks/Inbox","08 Tasks/Workspaces","08 Tasks/Projects"];
    const open=task("Filed tag","ongoing");open.record.project="Basic Needs";
    expect(eligibleForMove(open,roots)).toBe(true);
    expect(eligibleForMove(task("External","inbox","02 Programs/Basic-Needs/Basic Needs Tasks/Test/task.md"),roots)).toBe(false);
    expect(eligibleForMove(task("Similar prefix","inbox","08 Tasks/Inbox-old/Tasks/Test/task.md"),roots)).toBe(false);
    expect(eligibleForMove(task("Archived","archived"),roots)).toBe(false);
    expect(eligibleForMove({...open,relocatedBundle:true},roots)).toBe(false);
  });
  it("selects the first unfinished action and has an honest empty state", () => {
    const a=task("Actions");a.record.subtasks=[{title:"Done",completed:true,status:"completed"},{title:"Next",completed:false,status:"do-soon"}] as never;
    expect(nextObjectiveAction(a.record)).toBe("Next");expect(nextObjectiveAction({subtasks:[]})).toBe("Choose your next action");
  });
});
