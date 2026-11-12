import { describe, expect, it, vi } from "vitest";
import { mountExpandedContent } from "./lazy-details";

class Details extends EventTarget { open = false; }

describe("disclosure content", () => {
  it("does no attachment or action work while collapsed, and mounts only once", () => {
    const details = new Details(), render = vi.fn();
    mountExpandedContent(details as unknown as HTMLDetailsElement, render);
    expect(render).not.toHaveBeenCalled();
    details.open = true; details.dispatchEvent(new Event("toggle"));
    details.open = false; details.dispatchEvent(new Event("toggle"));
    details.open = true; details.dispatchEvent(new Event("toggle"));
    expect(render).toHaveBeenCalledTimes(1);
  });
  it("immediately restores previously expanded actions", () => {
    const details = new Details(), render = vi.fn(); details.open = true;
    mountExpandedContent(details as unknown as HTMLDetailsElement, render);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
