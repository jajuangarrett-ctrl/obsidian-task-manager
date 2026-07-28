import { describe, expect, test } from "vitest";
import { responseOutputText } from "./openai-response";

describe("OpenAI Responses parsing", () => {
  test("reads the nested REST API response", () => {
    expect(responseOutputText({
      output: [{
        content: [{ type: "output_text", text: "Prepare the final budget" }]
      }]
    })).toBe("Prepare the final budget");
  });

  test("keeps compatibility with output_text helpers", () => {
    expect(responseOutputText({ output_text: "Prepare the final budget" }))
      .toBe("Prepare the final budget");
  });
});
