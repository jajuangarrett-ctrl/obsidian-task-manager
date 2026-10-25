import type { TaskRecord } from "@fjg/task-core";
export const AGENDA_FOLDER = "05 People/Agenda Items";
export const OBJECTIVE_AGENDA_PATH = `${AGENDA_FOLDER}/_objectives.json`;
export const personKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
export function normalizePeople(names: readonly string[]): string[] {
  const result = new Map<string,string>();
  for (const value of names) { const name = String(value).trim().replace(/\s+/g," "); if(name && !result.has(personKey(name))) result.set(personKey(name),name); }
  return [...result.values()];
}
export function matchesPerson(record: Pick<TaskRecord,"people">, person: string): boolean {
  return !person || (person === "__none__" ? !record.people?.length : (record.people || []).some(name=>personKey(name)===personKey(person)));
}
export function agendaObjectives(tasks: readonly {record:TaskRecord; archived:boolean; taskFile:{path:string}}[]) {
  return tasks.filter(task=>!task.archived && !["completed","archived"].includes(task.record.status) && task.record.agenda_selected && task.record.people?.length)
    .map(({record,taskFile})=>({id:record.task_id,title:record.title,people:normalizePeople(record.people || []),status:record.status,due:record.due,priority:record.priority,path:taskFile.path}))
    .sort((a,b)=>a.id.localeCompare(b.id));
}

/** Preserve saved choices; only an unconfigured first assignment receives the default. */
export function agendaChoice(record: Pick<TaskRecord, "people" | "agenda_selected" | "agenda_preference_set">, people: readonly string[], explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  if (record.agenda_preference_set || record.people?.length || !people.length) return record.agenda_selected === true;
  return true;
}
