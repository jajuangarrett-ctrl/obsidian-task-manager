import { describe, expect, it } from "vitest";
import {
  archiveProjectRecord,
  createProjectRecord,
  normalizeProjectName,
  parseProjectDocument,
  parseProjectMarkdown,
  renderProjectDocument,
  reopenProjectRecord,
  renderProjectMarkdown
} from "./project-workspace";

describe("project workspaces", () => {
  it("normalizes names and round-trips a project definition", () => {
    const record = createProjectRecord("  Basic   Needs Expansion  ", "2026-07-28T08:00:00.000Z");
    const markdown = renderProjectMarkdown(record, "Coordinate the expansion work.");

    expect(record.name).toBe("Basic Needs Expansion");
    expect(record.status).toBe("active");
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

  it("loads pre-archive project files as active", () => {
    const legacy = `---
schema_version: 1
type: fjg-task-project
name: Legacy Project
created_at: 2026-07-28T08:00:00.000Z
updated_at: 2026-07-28T08:00:00.000Z
---
# Legacy Project
`;
    expect(parseProjectMarkdown(legacy)).toMatchObject({
      name: "Legacy Project",
      status: "active",
      archived_at: ""
    });
  });

  it("archives and reopens a project without changing its body", () => {
    const record = createProjectRecord("Finished Project", "2026-07-28T08:00:00.000Z");
    const markdown = renderProjectMarkdown(record, "Keep this project context.");
    const document = parseProjectDocument(markdown);
    const archived = archiveProjectRecord(record, new Date("2026-07-28T09:00:00.000Z"));
    const archivedDocument = parseProjectDocument(renderProjectDocument(archived, document.body));

    expect(archivedDocument.record).toMatchObject({
      status: "archived",
      archived_at: "2026-07-28T09:00:00.000Z"
    });
    expect(archivedDocument.body).toContain("Keep this project context.");

    expect(reopenProjectRecord(archived, new Date("2026-07-28T10:00:00.000Z"))).toMatchObject({
      status: "active",
      updated_at: "2026-07-28T10:00:00.000Z",
      archived_at: ""
    });
  });
});
