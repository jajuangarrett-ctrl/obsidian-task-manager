import { describe, expect, test } from "vitest";
import { parseMailTaskReviewPayload } from "./mail-review";

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

describe("Mail task review payload", () => {
  test("prefills a validated review draft and preserves email source metadata", () => {
    const draft = parseMailTaskReviewPayload(encode({
      version: 1,
      action: "review-task",
      title: "Review the August agenda",
      details: "Review Roberto's agenda before Friday.",
      status: "do-first",
      project: "City CE Transfer Day",
      due: "2026-08-28",
      delegated_to: "",
      source: { title: "Protect and Progress Meeting: August Agenda", url: "message://example" }
    }), ["City CE Transfer Day"]);

    expect(draft).toEqual({
      title: "Review the August agenda",
      details: "Review Roberto's agenda before Friday.",
      status: "do-first",
      project: "City CE Transfer Day",
      due: "2026-08-28",
      delegatedTo: "",
      source: {
        type: "email",
        title: "Protect and Progress Meeting: August Agenda",
        url: "message://example"
      }
    });
  });

  test("drops invented projects and unsafe field values", () => {
    const draft = parseMailTaskReviewPayload(encode({
      version: 1,
      action: "review-task",
      title: "Follow up",
      details: "Ask for a response.",
      status: "urgent-now",
      project: "Invented Project",
      due: "Friday",
      delegated_to: "Pat",
      source: {}
    }), ["Real Project"]);

    expect(draft.status).toBe("do-first");
    expect(draft.project).toBe("");
    expect(draft.due).toBe("");
  });

  test("rejects malformed and immediate-write payloads", () => {
    expect(() => parseMailTaskReviewPayload("not-json", [])).toThrow("could not be decoded");
    expect(() => parseMailTaskReviewPayload(encode({ version: 1, action: "create-task" }), []))
      .toThrow("Unsupported Mail task draft");
  });
});
