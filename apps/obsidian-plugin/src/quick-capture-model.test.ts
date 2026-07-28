import { describe, expect, test } from "vitest";
import {
  buildTaskDraftRequest,
  fallbackTaskTitle,
  normalizeTaskDraft,
  parseTaskDraftResponse,
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
  });

  test("parses nested Responses API text and constrains AI-selected values", () => {
    const response = {
      output: [{
        content: [{
          type: "output_text",
          text: JSON.stringify({
            title: "Send final budget to Maria",
            details: "Send the final budget package.",
            status: "delegate",
            project: "budget",
            due: "2026-07-28",
            delegated_to: "Maria"
          })
        }]
      }]
    };
    expect(parseTaskDraftResponse(response, "raw", ["Budget"])).toEqual({
      title: "Send final budget to Maria",
      details: "Send the final budget package.",
      status: "delegate",
      project: "Budget",
      due: "2026-07-28",
      delegatedTo: "Maria"
    });
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

  test("limits a fallback title to twelve words", () => {
    expect(fallbackTaskTitle("One two three four five six seven eight nine ten eleven twelve thirteen"))
      .toBe("One two three four five six seven eight nine ten eleven twelve");
  });
});
