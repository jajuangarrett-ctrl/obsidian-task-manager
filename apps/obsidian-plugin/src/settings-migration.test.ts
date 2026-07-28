import { describe, expect, test } from "vitest";
import { legacyOpenAiApiKey } from "./settings-migration";

describe("legacy settings migration", () => {
  test("reads the OpenAI key saved by the older Task Capture plugin", () => {
    expect(legacyOpenAiApiKey({
      openaiApiKey: "  sk-project-example  ",
      anthropicApiKey: ""
    })).toBe("sk-project-example");
  });

  test("does not coerce missing or malformed values into credentials", () => {
    expect(legacyOpenAiApiKey({ openaiApiKey: 123 })).toBe("");
    expect(legacyOpenAiApiKey(null)).toBe("");
  });
});
