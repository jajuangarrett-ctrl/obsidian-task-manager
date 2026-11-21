import { createTaskRecord, type TaskRecord } from "@fjg/task-core";
import { describe, expect, it } from "vitest";
import {
  APP_SCOPES, appFocusIncludes, appSectionGroups, appTaskMatchesSearch, canEditAppObjective, isAppFocus,
} from "./objectives-app-model";
import type { IndexedTask } from "./workspace-service";

type AppTask = Parameters<typeof appFocusIncludes>[0];
const make = (record: Partial<TaskRecord> = {}, opts: { path?: string; archived?: boolean; assigned?: boolean } = {}): AppTask => ({
  record: { ...createTaskRecord({ title: "Synthetic Objective", taskId: "plan-token", status: "do-first" }), ...record },
  archived: opts.archived ?? false,
  statusAssigned: opts.assigned ?? true,
  taskFile: { path: opts.path ?? "Test Areas/Launch/Tasks/Synthetic Objective/Task.md" } as IndexedTask["taskFile"],
});
const context = { today: "2026-02-28", inboxRoot: "Sample/Inbox" };

describe("Objectives App View projections of canonical task records", () => {
  it("projects only genuine terminal records onto one Completed focus", () => {
    expect(APP_SCOPES.filter(([, title]) => title === "Completed")).toEqual([["completed", "Completed"]]);
    expect(isAppFocus("archived")).toBe(false);
    expect(appFocusIncludes(make({ status: "completed" }), "completed", context)).toBe(true);
    const legacy = make({ status: "completed", __fjgSourceArchived: true }, { archived: true });
    expect(appFocusIncludes(legacy, "completed", context)).toBe(true);
    expect(appFocusIncludes(legacy, "overview", context)).toBe(false);
    expect(appFocusIncludes(make({ status: "archived" }), "completed", context)).toBe(true);
    expect(appFocusIncludes(make({}, { archived: true }), "completed", context)).toBe(false);
    expect(appFocusIncludes(make({ status: "completed" }, { assigned: false }), "completed", context)).toBe(false);
    expect(canEditAppObjective(legacy)).toBe(false);
  });

  it("keeps converted originals in a dedicated read-only projection", () => {
    const original = make({ status: "completed", converted_to: { parent_task_id: "parent", action_id: "action", converted_at: "" } });
    for (const [scope] of APP_SCOPES) expect(appFocusIncludes(original, scope, context)).toBe(scope === "converted");
    expect(canEditAppObjective(original)).toBe(false);
  });

  it("uses the configured Inbox folder and does not confuse unassigned/legacy records with Inbox status", () => {
    const unassigned = make({ status: "inbox" }, { assigned: false, path: "Sample/Inbox/A/Task.md" });
    const archived = make({ status: "completed", __fjgSourceArchived: true }, { path: "Sample/Inbox/B/Task.md" });
    expect(appFocusIncludes(unassigned, "inbox-folder", context)).toBe(true);
    expect(appFocusIncludes(unassigned, "unassigned", context)).toBe(true);
    expect(appFocusIncludes(unassigned, "status:inbox", context)).toBe(false);
    expect(appFocusIncludes(archived, "inbox-folder", context)).toBe(false);
    expect(appFocusIncludes(make({}, { path: "Sample/Inbox2/A/Task.md" }), "inbox-folder", context)).toBe(false);
    expect(appFocusIncludes(make({ status: "inbox" }), "status:inbox", context)).toBe(true);
  });

  it("treats Today and Due or Overdue as local inclusive calendar days and excludes closed work", () => {
    const dueToday = make({ due: context.today });
    const prior = make({ due: "2026-02-27" });
    const future = make({ due: "2026-03-01" });
    expect(appFocusIncludes(dueToday, "today", context)).toBe(true);
    expect(appFocusIncludes(dueToday, "due", context)).toBe(true);
    expect(appFocusIncludes(prior, "today", context)).toBe(false);
    expect(appFocusIncludes(prior, "due", context)).toBe(true);
    expect(appFocusIncludes(future, "upcoming", context)).toBe(true);
    expect(appFocusIncludes(future, "calendar", { ...context, calendarDay: "2026-03-01" })).toBe(true);
    expect(appFocusIncludes(make({ due: "2026-02-29" }), "upcoming", context)).toBe(false);
    expect(appFocusIncludes(make({ due: context.today, status: "completed" }), "due", context)).toBe(false);
    expect(appFocusIncludes(make({ due: context.today, status: "completed" }), "calendar", context)).toBe(false);
  });

  it("matches searchable indexed labels and keeps the native section order without changing records", () => {
    const target = make({ title: "Synthetic Enrollment", project: "Launch", people: ["Example person"] });
    const inbox = make({ status: "inbox" });
    expect(appTaskMatchesSearch(target, "enrollment launch example")).toBe(true);
    expect(appTaskMatchesSearch(target, "plan-token")).toBe(true);
    expect(appTaskMatchesSearch(target, "not in fixture")).toBe(false);
    expect(appSectionGroups([target, inbox], true).map(group => group.status)).toEqual(["inbox", "do-first"]);
    expect(appSectionGroups([target], false).map(group => group.status)).toEqual([
      "inbox", "do-first", "do-soon", "ongoing", "delegate", "waiting", "on-hold", "completed",
    ]);
    expect(target.record.status).toBe("do-first");
  });
});
