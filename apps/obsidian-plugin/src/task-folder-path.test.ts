import { describe, expect, it } from "vitest";
import { taskFolderClipboardPath } from "./task-folder-path";

describe("task folder clipboard paths", () => {
  it("joins a macOS vault root to the vault-relative task folder", () => {
    expect(taskFolderClipboardPath(
      "08 Tasks/Workspaces/Purchase a swing outdoor for CalWorks",
      "/Users/franklingarrett/FJG Vault"
    )).toBe(
      "/Users/franklingarrett/FJG Vault/08 Tasks/Workspaces/Purchase a swing outdoor for CalWorks"
    );
  });

  it("does not duplicate a trailing desktop separator", () => {
    expect(taskFolderClipboardPath("08 Tasks/Archive/Finished task", "/Vault/"))
      .toBe("/Vault/08 Tasks/Archive/Finished task");
  });

  it("uses native Windows separators for desktop paths", () => {
    expect(taskFolderClipboardPath(
      "08 Tasks/Workspaces/Windows task",
      "C:\\Users\\Franklin\\FJG Vault"
    )).toBe("C:\\Users\\Franklin\\FJG Vault\\08 Tasks\\Workspaces\\Windows task");
  });

  it("returns the vault-relative folder on mobile", () => {
    expect(taskFolderClipboardPath("08 Tasks/Workspaces/Mobile task"))
      .toBe("08 Tasks/Workspaces/Mobile task");
  });
});
