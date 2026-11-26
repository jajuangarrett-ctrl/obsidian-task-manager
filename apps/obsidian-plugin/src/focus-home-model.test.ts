import { describe,it,expect } from "vitest";
import { createTaskRecord,parseTaskMarkdown,renderTaskMarkdown,validatePlanningDay } from "@fjg/task-core";
import { focusGroups,addFocusDays } from "./focus-home-model";
import type { IndexedTask } from "./workspace-service";

const anchor="2026-11-26";
const make=(title:string,status="inbox",due="",scheduledFor="",extra={})=>({
  archived:false,taskFile:{path:`02 Programs/One Tasks/${title}/task.md`},
  record:{...createTaskRecord({title,status,due,scheduledFor}),...extra}
}) as unknown as IndexedTask;
const labels=(ts:IndexedTask[], key:Parameters<typeof focusGroups>[1])=>focusGroups(ts,key,anchor,[]).flatMap(g=>g.tasks.map(t=>t.record.title));
describe("Focus Lists smart filters",()=>{
  it("separates scheduled dates from deadlines and uses one group per objective per list",()=>{
    const today=make("Today planned","ongoing","2026-11-30",anchor);
    const both=make("Two dates","do-soon","2026-11-29","2026-11-28");
    const overdue=make("Overdue","waiting","2026-11-25","2026-11-27");
    const priority=make("Priority","do-first");
    const tasks=[today,both,overdue,priority,both];
    expect(labels(tasks,"today")).toEqual(["Overdue","Today planned","Priority"]);
    expect(labels(tasks,"upcoming")).toEqual(["Overdue","Two dates","Today planned"]);
    expect(focusGroups(tasks,"upcoming",anchor,[]).find(g=>g.tasks.includes(both))?.scheduleDay).toBe("2026-11-28");
  });
  it("keeps completion, legacy archive and conversion separate and includes area descendants",()=>{
    const tasks=[make("Capture"),make("Waiting","waiting"),make("Later","on-hold"),make("Any","do-soon"),
      make("Done","completed"),make("Old","completed","","",{__fjgSourceArchived:true}),
      make("Converted","completed","","",{converted_to:{parent_task_id:"a",action_id:"b",converted_at:"now"}})];
    expect(labels(tasks,"inbox")).toEqual(["Capture"]);
    expect(labels(tasks,"someday")).toEqual(["Later"]);
    expect(labels(tasks,"anytime")).toEqual(["Any"]);
    expect(labels(tasks,"logbook")).toEqual(["Done"]);
    expect(focusGroups(tasks,"area:02 Programs/One Tasks",anchor,[{name:"One",label:"One",path:"02 Programs/One Tasks",count:4}])[0].tasks).toHaveLength(4);
  });
  it("round-trips an optional planning day without touching due or accepting impossible dates",()=>{
    const record=createTaskRecord({title:"Plan it",due:"2026-12-01",scheduledFor:"2026-11-27"});
    expect(parseTaskMarkdown(renderTaskMarkdown(record)).record).toMatchObject({due:"2026-12-01",scheduled_for:"2026-11-27"});
    expect(renderTaskMarkdown(createTaskRecord({title:"Old format"}))).not.toContain("scheduled_for");
    expect(()=>validatePlanningDay("2026-02-31")).toThrow();
    expect(addFocusDays("2026-12-31",1)).toBe("2027-01-01");
  });
});

it("offers past-due deadlines separately from today's deadlines, stale plans and finished work",()=>{
  const tasks=[make("Overdue waiting","waiting","2026-11-25"),make("Overdue hold","on-hold","2026-10-17","2026-12-02"),
    make("Due today","do-soon",anchor),make("Stale plan","ongoing","","2026-11-24"),make("Finished","completed","2026-11-23")];
  expect(labels(tasks,"past-due")).toEqual(["Overdue hold","Overdue waiting"]);
  expect(focusGroups(tasks,"today",anchor,[])[0]).toMatchObject({label:"Past Due",tasks:[tasks[1],tasks[0]]});
});
