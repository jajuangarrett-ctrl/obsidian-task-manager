import { describe, expect, test } from "vitest";
import { cleanEmailSubject, firstMeaningfulLine, sourceForPage, splitSelectedLines } from "./capture";

describe("browser capture", () => {
  test("keeps multiline selections as one input until explicitly split", () => {
    const input = "First task\nSecond task";
    expect(firstMeaningfulLine(input)).toBe("First task");
    expect(splitSelectedLines(input)).toEqual(["First task", "Second task"]);
  });

  test("cleans task syntax from selected lines", () => {
    expect(splitSelectedLines("- [ ] Review packet\n* Send email")).toEqual(["Review packet", "Send email"]);
  });

  test("stores email subjects without mailbox URLs", () => {
    expect(cleanEmailSubject("Budget Review - Outlook")).toBe("Budget Review");
    expect(sourceForPage({ sourceKind: "email", title: "Budget Review - Outlook", url: "https://outlook.office.com/mail" }, true))
      .toEqual({ type: "email", title: "Budget Review", url: "" });
  });
});
