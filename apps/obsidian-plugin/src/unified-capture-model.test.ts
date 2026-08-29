import { describe, expect, test } from "vitest";
import {
  prepareUnifiedCapture,
  UNIFIED_CAPTURE_ACTIONS
} from "./unified-capture-model";

describe("unified capture model", () => {
  test.each(UNIFIED_CAPTURE_ACTIONS)("prepares the %s review route", (action) => {
    expect(prepareUnifiedCapture(action, "  First line\nSecond line  ")).toEqual({
      action,
      text: "First line\nSecond line"
    });
  });

  test("rejects empty text", () => {
    expect(() => prepareUnifiedCapture("new-task", " \n ")).toThrow(
      "Paste or type some text"
    );
  });

  test("rejects an unsupported route", () => {
    expect(() => prepareUnifiedCapture("mail", "text")).toThrow(
      "Choose what you want"
    );
  });
});
