import { describe,it,expect } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createTaskRecord,parseTaskMarkdown,renderTaskMarkdown,updateTaskFields } from "@fjg/task-core";
import { agendaObjectives,matchesPerson,normalizePeople } from "./people-model";

describe("People and agenda snapshots",()=>{
 it("preserves legacy metadata, IDs and body while persisting multiple people and opt-in",()=>{
  const original=createTaskRecord({title:"Review",project:"Existing project",tags:["approved"],people:["Leyla Recinos"],agendaSelected:true});
  const next=updateTaskFields(original,{people:normalizePeople(["Leyla Recinos"," leyla  recinos ","Dr. Carter"])});
  const parsed=parseTaskMarkdown(renderTaskMarkdown(next,"# Review\n\nKeep this content.\n"));
  expect(parsed.record.people).toEqual(["Leyla Recinos","Dr. Carter"]);expect(parsed.record.agenda_selected).toBe(true);
  expect(parsed.record.tags).toEqual(original.tags);expect(parsed.record.project).toBe(original.project);expect(parsed.record.task_id).toBe(original.task_id);expect(parsed.body).toContain("Keep this content.");
  expect(matchesPerson(parsed.record,"LEYLA RECINOS")).toBe(true);expect(matchesPerson(parsed.record,"__none__")).toBe(false);
 });
 it("exports only selected open objectives with people, retaining relative source paths",()=>{
  const base=createTaskRecord({title:"Review",people:["Leyla Recinos"],agendaSelected:true});
  const tasks=[base,{...base,task_id:"completed",status:"completed" as const},{...base,task_id:"archived",status:"archived" as const},{...base,task_id:"deselected",agenda_selected:false},{...base,task_id:"no-people",people:[]}].map(record=>({record,archived:false,taskFile:{path:"08 Tasks/Inbox/Tasks/Review/task.md"}}));
  expect(agendaObjectives(tasks)).toHaveLength(1);expect(agendaObjectives(tasks)[0].path).toBe(tasks[0].taskFile.path);
 });
 it("merges folder items and objectives without duplicates; clears removed objectives and isolates meeting progress keys",()=>{
  const context=vm.createContext({});vm.runInContext(readFileSync("integrations/agenda-dashboard/objective-agendas.js","utf8"),context);
  const bridge=context.FJGObjectiveAgendas;
  const roster=[{name:"Leyla Recinos",tasks:[{key:"original",title:"Existing agenda topic"}]}];
  const snapshot={version:1,objectives:[{id:"one",title:"Review",people:[" leyla recinos ","Dr. Carter"],status:"do-first"}]};
  const first=bridge.merge(roster,snapshot),second=bridge.merge(first,snapshot);
  expect(second[0].tasks).toHaveLength(2);expect(second[1].tasks).toHaveLength(1);
  expect(second[0].tasks[1].key).not.toEqual(second[1].tasks[0].key);
  expect(bridge.merge(second,{version:1,objectives:[]})[0].tasks).toEqual(roster[0].tasks);
  expect(()=>bridge.merge(roster,{version:3,objectives:[]})).toThrow();
 });
});
