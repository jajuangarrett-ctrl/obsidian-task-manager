import { describe, expect, it } from "vitest";
import {
  formatFileSize,
  isCanonicalTaskFile,
  markdownPreview,
  relatedFileKind,
  safeRelatedFileName
} from "./related-files";

describe("related files", () => {
  it("classifies common task documents", () => {
    expect(relatedFileKind("md")).toBe("note");
    expect(relatedFileKind(".JPG")).toBe("image");
    expect(relatedFileKind("pdf")).toBe("pdf");
    expect(relatedFileKind("docx")).toBe("document");
    expect(relatedFileKind("zip")).toBe("file");
  });

  it("excludes only canonical workspace Markdown", () => {
    expect(isCanonicalTaskFile("task.md")).toBe(true);
    expect(isCanonicalTaskFile("UPDATES.MD")).toBe(true);
    expect(isCanonicalTaskFile("meeting-notes.md")).toBe(false);
  });

  it("creates a readable Markdown preview", () => {
    const preview = markdownPreview(`---
title: Hidden
---
# Meeting notes

Follow up with [[Franklin Garrett|Franklin]] about the [quote](https://example.com).
`);
    expect(preview).toBe("Meeting notes Follow up with Franklin about the quote.");
  });

  it("truncates previews and formats sizes", () => {
    expect(markdownPreview("A".repeat(20), 10)).toBe("AAAAAAAAA…");
    expect(formatFileSize(800)).toBe("800 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1572864)).toBe("1.5 MB");
  });

  it("sanitizes user-provided file names", () => {
    expect(safeRelatedFileName(`  Quote: RM/116?.pdf  `)).toBe("Quote RM 116.pdf");
    expect(safeRelatedFileName("...")).toBe("Untitled");
  });
});
