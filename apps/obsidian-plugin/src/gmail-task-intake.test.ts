import { describe, expect, test } from "vitest";
import { markGmailTaskIntakeImported, parseGmailTaskIntake } from "./gmail-task-intake";

const intake = `---
fjg_task_intake_version: 1
gmail_message_id: "19abc123"
email_subject: "[Do First] Call Michelle"
email_date: "2026-07-31T18:05:00.000Z"
task_title: "Call Michelle"
task_status: "do-first"
fjg_task_manager_task_id: ""
fjg_task_manager_imported_at: ""
---
Email body.
`;

describe("Gmail task intake", () => {
  test("parses canonical task metadata and creates deterministic IDs", () => {
    expect(parseGmailTaskIntake(intake)).toEqual({
      messageId: "19abc123",
      taskId: "tsk_gmail_19abc123",
      requestId: "gmail_19abc123",
      title: "Call Michelle",
      status: "do-first",
      emailSubject: "[Do First] Call Michelle",
      emailDate: "2026-07-31T18:05:00.000Z",
      importedTaskId: ""
    });
  });

  test("ignores ordinary Mira email notes", () => {
    expect(parseGmailTaskIntake("Just an ordinary email body.\n")).toBeNull();
  });

  test("marks an intake while preserving its email body", () => {
    const marked = markGmailTaskIntakeImported(
      intake,
      "tsk_gmail_19abc123",
      "2026-07-31T18:06:00.000Z"
    );
    expect(marked).toContain("fjg_task_manager_task_id: tsk_gmail_19abc123");
    expect(marked).toContain('fjg_task_manager_imported_at: "2026-07-31T18:06:00.000Z"');
    expect(marked.endsWith("Email body.\n")).toBe(true);
    expect(parseGmailTaskIntake(marked)?.importedTaskId).toBe("tsk_gmail_19abc123");
  });

  test("rejects noncanonical statuses instead of silently using Inbox", () => {
    const invalid = intake.replace('task_status: "do-first"', 'task_status: "urgent"');
    expect(() => parseGmailTaskIntake(invalid)).toThrow("not canonical");
  });
});
