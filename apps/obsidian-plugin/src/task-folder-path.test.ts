import { describe, expect, it } from "vitest";
import { taskFolderClipboardPath } from "./task-folder-path";

describe("task folder clipboard paths", () => {
  it("returns the vault-relative folder expected by Obsidian Web Clipper", () => {
    expect(taskFolderClipboardPath(
      "08 Tasks/Workspaces/Fw MIS inputs for Summer 2026"
    )).toBe("08 Tasks/Workspaces/Fw MIS inputs for Summer 2026");
  });

  it("removes leading and trailing separators", () => {
    expect(taskFolderClipboardPath("/08 Tasks/Archive/Finished task/"))
      .toBe("08 Tasks/Archive/Finished task");
  });

  it("normalizes Windows and repeated separators to portable vault separators", () => {
    expect(taskFolderClipboardPath(
      "\\08 Tasks\\Workspaces\\\\Portable task\\"
    )).toBe("08 Tasks/Workspaces/Portable task");
  });
});
