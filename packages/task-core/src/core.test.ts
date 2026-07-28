import { describe, expect, test } from "vitest";
import {
  appendUpdateMarkdown,
  canTransition,
  createTaskRecord,
  normalizeStatus,
  normalizeTags,
  legacyTaskFolderName,
  numberedTaskFolderName,
  parseTaskMarkdown,
  renderTaskMarkdown,
  renderUpdatesMarkdown,
  sanitizeTitleForPath,
  taskFolderName,
  transitionTaskRecord,
  validateTaskRecord
} from "./index";

describe("task core", () => {
  test("normalizes the approved status vocabulary", () => {
    expect(normalizeStatus("DoFirst")).toBe("do-first");
    expect(normalizeStatus("do soon")).toBe("do-soon");
    expect(normalizeStatus("Cancelled")).toBe("archived");
    expect(canTransition("archived", "do-first")).toBe(true);
  });

  test("keeps task as the sole default and strips status tags", () => {
    expect(normalizeTags([])).toEqual(["task"]);
    expect(normalizeTags(["task", "DoFirst", "Basic-Needs", "waiting"])).toEqual(["task", "Basic-Needs"]);
  });

  test("creates readable stable folder names", () => {
    expect(sanitizeTitleForPath('Review: "budget" / packet')).toBe("Review budget packet");
    expect(taskFolderName("tsk_123", "Review budget")).toBe("Review budget");
    expect(numberedTaskFolderName("tsk_456", "Review budget", 2)).toBe("Review budget (2)");
    expect(legacyTaskFolderName("tsk_123", "Review budget")).toBe("tsk_123 - Review budget");
  });

  test("round trips task Markdown", () => {
    const record = createTaskRecord({
      taskId: "tsk_test",
      title: "Review budget packet",
      status: "DoFirst",
      tags: ["task", "DoFirst"],
      source: { type: "web", title: "Budget", url: "https://example.com/budget" },
      createdAt: "2026-07-27T16:00:00.000Z"
    });
    const markdown = renderTaskMarkdown(record);
    const parsed = parseTaskMarkdown(markdown);
    expect(parsed.record.status).toBe("do-first");
    expect(parsed.record.tags).toEqual(["task"]);
    expect(parsed.body).toContain("# Review budget packet");
    expect(validateTaskRecord(parsed.record)).toEqual([]);
  });

  test("transitions completion and reopening timestamps", () => {
    const record = createTaskRecord({ taskId: "tsk_test", title: "Test", createdAt: "2026-07-27T16:00:00.000Z" });
    const completed = transitionTaskRecord(record, "completed", new Date("2026-07-28T16:00:00.000Z"));
    expect(completed.completed_at).toBe("2026-07-28T16:00:00.000Z");
    const reopened = transitionTaskRecord(completed, "do-first", new Date("2026-07-29T16:00:00.000Z"));
    expect(reopened.completed_at).toBe("");
  });

  test("appends idempotent update blocks", () => {
    const first = appendUpdateMarkdown(renderUpdatesMarkdown(), {
      updateId: "upd_test",
      requestId: "req_test",
      actor: "Franklin",
      type: "update",
      text: "Reviewed the packet.",
      createdAt: "2026-07-27T16:00:00.000Z"
    });
    const second = appendUpdateMarkdown(first, {
      updateId: "upd_other",
      requestId: "req_test",
      actor: "Franklin",
      text: "Duplicate request."
    });
    expect(second).toBe(first);
  });
});
