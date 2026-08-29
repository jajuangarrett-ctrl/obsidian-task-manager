import { describe, expect, it } from "vitest";
import {
  decodeSystemCaptureClipboard,
  SYSTEM_CAPTURE_CLIPBOARD_PREFIX
} from "./system-capture-clipboard";

describe("system capture clipboard handoff", () => {
  it("decodes text produced by the macOS Shortcut", () => {
    const encoded = encodeURIComponent("Follow up with SSS Team\nBring September dates");
    expect(decodeSystemCaptureClipboard(`${SYSTEM_CAPTURE_CLIPBOARD_PREFIX}${encoded}`)).toBe(
      "Follow up with SSS Team\nBring September dates"
    );
  });

  it("allows an empty marker so the review window supports manual entry", () => {
    expect(decodeSystemCaptureClipboard(SYSTEM_CAPTURE_CLIPBOARD_PREFIX)).toBe("");
  });

  it("ignores ordinary clipboard content", () => {
    expect(decodeSystemCaptureClipboard("ordinary copied text")).toBeNull();
  });

  it("preserves malformed or unencoded payloads instead of dropping text", () => {
    expect(decodeSystemCaptureClipboard(`${SYSTEM_CAPTURE_CLIPBOARD_PREFIX}100% ready`)).toBe(
      "100% ready"
    );
  });
});
