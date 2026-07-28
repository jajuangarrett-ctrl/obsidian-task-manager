import { describe, expect, it } from "vitest";
import {
  createProjectRecord,
  normalizeProjectName,
  parseProjectMarkdown,
  renderProjectMarkdown
} from "./project-workspace";

describe("project workspaces", () => {
  it("normalizes names and round-trips a project definition", () => {
    const record = createProjectRecord("  Basic   Needs Expansion  ", "2026-07-28T08:00:00.000Z");
    const markdown = renderProjectMarkdown(record, "Coordinate the expansion work.");

    expect(record.name).toBe("Basic Needs Expansion");
    expect(parseProjectMarkdown(markdown)).toEqual(record);
    expect(markdown).toContain("# Basic Needs Expansion");
    expect(markdown).toContain("Coordinate the expansion work.");
  });

  it("rejects an empty project name", () => {
    expect(normalizeProjectName("   ")).toBe("");
    expect(() => createProjectRecord("   ")).toThrow("Enter a project name.");
  });

  it("rejects ordinary Markdown notes", () => {
    expect(() => parseProjectMarkdown("# Notes")).toThrow("Project frontmatter is missing.");
  });
});
