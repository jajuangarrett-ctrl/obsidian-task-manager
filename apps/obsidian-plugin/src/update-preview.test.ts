import { describe, expect, test } from "vitest";
import { parseTaskUpdatePreviews } from "./update-preview";

describe("task update previews", () => {
  test("returns newest updates first and removes audit metadata", () => {
    const markdown = `# Updates

### 2026-07-27 21:34 — Franklin

- Update ID: \`upd_created\`
- Type: \`created\`
- Status: \`none\` → \`waiting\`

Task workspace created.

### 2026-07-27 23:08 — Franklin

- Update ID: \`upd_update\`
- Type: \`update\`

We're waiting for a revised quote.

Email source: subject unavailable
`;
    expect(parseTaskUpdatePreviews(markdown)).toEqual([
      {
        timestamp: "2026-07-27 23:08",
        actor: "Franklin",
        type: "update",
        text: "We're waiting for a revised quote.\n\nEmail source: subject unavailable"
      },
      {
        timestamp: "2026-07-27 21:34",
        actor: "Franklin",
        type: "created",
        text: "Task workspace created."
      }
    ]);
  });

  test("accepts update logs with frontmatter", () => {
    const markdown = `---
title: updates
---
# Updates

### 2026-07-27 23:08 — Browser clipper

- Update ID: \`upd_update\`
- Type: \`update\`

Check the order status.
`;
    expect(parseTaskUpdatePreviews(markdown)[0]?.text).toBe("Check the order status.");
  });
});
