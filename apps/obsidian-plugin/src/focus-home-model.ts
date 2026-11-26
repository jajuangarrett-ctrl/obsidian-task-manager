import { isConvertedOriginal, planningDay } from "@fjg/task-core";
import { objectiveAreaPath, type ObjectiveArea } from "./area-model";
import type { IndexedTask } from "./workspace-service";

export const FOCUS_LISTS = [
  { key: "inbox", label: "Inbox", icon: "inbox", tone: "blue" },
  { key: "today", label: "Today", icon: "star", tone: "gold" },
  { key: "past-due", label: "Past Due", icon: "calendar-clock", tone: "red" },
  { key: "upcoming", label: "Upcoming", icon: "calendar-days", tone: "pink" },
  { key: "anytime", label: "Anytime", icon: "layers", tone: "teal" },
  { key: "someday", label: "Someday", icon: "archive", tone: "amber" },
  { key: "logbook", label: "Logbook", icon: "book-check", tone: "green" },
] as const;

export type FocusList = (typeof FOCUS_LISTS)[number]["key"] | `area:${string}`;
export type FocusGroup = { key: string; label: string; tasks: IndexedTask[]; scheduleDay?: string };
export const canUseFocusObjective = (t: IndexedTask) => !t.archived && !t.record.__fjgSourceArchived
  && t.record.status !== "archived" && !isConvertedOriginal(t.record);
export const canScheduleFocusObjective = (t: IndexedTask) => canUseFocusObjective(t) && t.record.status !== "completed";

export function focusDayLabel(day: string): string {
  return new Date(day + "T12:00:00").toLocaleDateString(undefined, {weekday:"short",month:"short",day:"numeric",...(day.slice(0,4)!==String(new Date().getFullYear())?{year:"numeric"}:{})});
}
export function addFocusDays(day: string, days: number): string {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0,10);
}
export function focusGroups(tasks: readonly IndexedTask[], list: FocusList, today: string, areas: readonly ObjectiveArea[], query = ""): FocusGroup[] {
  const needle = query.trim().toLocaleLowerCase();
  const groups = new Map<string, FocusGroup>();
  const seen = new Set<string>();
  const add = (key: string, label: string, task?: IndexedTask, scheduleDay?: string) => {
    const group = groups.get(key) ?? {key,label,tasks:[],scheduleDay};
    if (task) group.tasks.push(task);
    groups.set(key, group);
  };
  if (list==="upcoming") add(addFocusDays(today,1),"Tomorrow",undefined,addFocusDays(today,1));
  if (list==="today") add("1-today","Today",undefined,today);
  for (const task of tasks) {
    const r = task.record;
    if(!canUseFocusObjective(task) || seen.has(r.task_id) || (needle && ![r.title,r.project,...r.tags,...r.subtasks.map(x=>x.title)].join(" ").toLocaleLowerCase().includes(needle))) continue;
    seen.add(r.task_id);
    const done = r.status === "completed";
    const plan = planningDay(r.scheduled_for), due = planningDay(r.due);
    const dates = [plan,due].filter(Boolean).sort();
    if (list==="logbook") {
      if (done) { const day = planningDay(r.completed_at.slice(0,10)); add(day||"0000",day ? focusDayLabel(day) : "Earlier",task); }
    } else if (!done) {
      if (list==="past-due") {
        if (due && due<today) add("0-overdue","",task);
      } else if (list==="today") {
        if (due && due<today) add("0-overdue","Past Due",task);
        else if (dates[0] && dates[0]<=today) add("1-today","Today",task,today);
        else if (!dates.length && r.status==="do-first") add("2-priority","Do First · not scheduled",task);
      } else if (list==="upcoming") {
        const day = dates.find(date=>date>today);
        if (day) add(day,day===addFocusDays(today,1)?"Tomorrow":focusDayLabel(day),task,day);
      } else if (list==="inbox" ? r.status==="inbox" && !plan
        : list==="someday" ? r.status==="on-hold"
        : list==="anytime" ? !dates.length && ["do-first","do-soon","ongoing"].includes(r.status)
        : list.startsWith("area:") && objectiveAreaPath(task,areas)===list.slice(5)) {
        add("list","",task);
      }
    }
  }
  return [...groups.values()].filter(g=>g.tasks.length || (!needle && !!g.scheduleDay))
    .sort((a,b)=>(list==="logbook"?-1:1)*a.key.localeCompare(b.key)).map(g=>({...g,tasks:g.tasks.sort((a,b)=>
      (list==="logbook" ? b.record.completed_at.localeCompare(a.record.completed_at) : 0) ||
      (a.record.due||"9999").localeCompare(b.record.due||"9999") ||
      b.record.updated_at.localeCompare(a.record.updated_at) || a.record.title.localeCompare(b.record.title) || a.record.task_id.localeCompare(b.record.task_id))}));
}
