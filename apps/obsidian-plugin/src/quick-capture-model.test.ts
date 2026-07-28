import { describe, expect, test } from "vitest";
import {
  buildTaskDraftRequest,
  fallbackTaskTitle,
  MAX_CAPTURE_DRAFTS,
  normalizeTaskDraft,
  normalizeTaskDrafts,
  parseTaskDraftsResponse,
  responseText
} from "./quick-capture-model";

describe("quick capture model", () => {
  test("builds a strict structured response request with the current project list", () => {
    const request = buildTaskDraftRequest(
      "Send the final budget to Maria tomorrow",
      "gpt-4.1-mini",
      {
        projects: ["Budget", "Basic Needs"],
        now: new Date("2026-07-27T18:00:00.000Z"),
        timeZone: "America/Los_Angeles"
      }
    );
    expect(request.model).toBe("gpt-4.1-mini");
    expect(JSON.stringify(request)).toContain("2026-07-27");
    expect(JSON.stringify(request)).toContain("Basic Needs | Budget");
    expect(JSON.stringify(request)).toContain("json_schema");
    expect(JSON.stringify(request)).toContain("Do not merge independent actions");
    expect(JSON.stringify(request)).toContain("Never invent today, tomorrow, or another due date");
    expect((request.text as any).format.schema.properties.tasks).toMatchObject({
      type: "array",
      minItems: 1,
      maxItems: MAX_CAPTURE_DRAFTS
    });
  });

  test("parses multiple nested Responses API task drafts and constrains AI-selected values", () => {
    const response = {
      output: [{
        content: [{
          type: "output_text",
          text: JSON.stringify({
            tasks: [{
              title: "Create plan for CalWORKs intern",
              details: "Create a plan for the CalWORKs intern.",
              status: "do-first",
              project: "",
              due: "",
              delegated_to: ""
            }, {
              title: "Create plan for BSSP intern",
              details: "Create a plan for the BSSP intern.",
              status: "do-first",
              project: "basic needs",
              due: "",
              delegated_to: ""
            }]
          })
        }]
      }]
    };
    expect(parseTaskDraftsResponse(response, "raw", ["Basic Needs"])).toEqual([{
      title: "Create plan for CalWORKs intern",
      details: "Create a plan for the CalWORKs intern.",
      status: "do-first",
      project: "",
      due: "",
      delegatedTo: ""
    }, {
      title: "Create plan for BSSP intern",
      details: "Create a plan for the BSSP intern.",
      status: "do-first",
      project: "Basic Needs",
      due: "",
      delegatedTo: ""
    }]);
  });

  test("falls back safely when the AI returns unknown project, status, date, or empty fields", () => {
    expect(normalizeTaskDraft({
      title: "",
      details: "",
      status: "completed",
      project: "Invented Project",
      due: "tomorrow",
      delegated_to: ""
    }, "Review the contract with Alex before signing", ["Legal"])).toEqual({
      title: "Review the contract with Alex before signing",
      details: "Review the contract with Alex before signing",
      status: "do-first",
      project: "",
      due: "",
      delegatedTo: ""
    });
  });

  test("reads the direct output_text compatibility field", () => {
    expect(responseText({ output_text: "Draft result" })).toBe("Draft result");
  });

  test("keeps compatibility with a single legacy draft object", () => {
    expect(normalizeTaskDrafts({
      title: "Review the contract",
      details: "Review the contract before signing.",
      status: "do-first",
      project: "",
      due: "",
      delegated_to: ""
    }, "Review the contract", [])).toEqual([{
      title: "Review the contract",
      details: "Review the contract before signing.",
      status: "do-first",
      project: "",
      due: "",
      delegatedTo: ""
    }]);
  });

  test("limits a fallback title to twelve words", () => {
    expect(fallbackTaskTitle("One two three four five six seven eight nine ten eleven twelve thirteen"))
      .toBe("One two three four five six seven eight nine ten eleven twelve");
  });
});
