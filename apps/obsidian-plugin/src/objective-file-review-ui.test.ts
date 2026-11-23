import { describe, expect, it, vi } from "vitest";

class FakeElement {
  children: FakeElement[] = [];
  listeners = new Map<string, (event: { isTrusted: boolean }) => void>();
  attrs: Record<string, string>;
  hidden = false;
  disabled = false;
  constructor(public tag = "div", public text = "", attr: Record<string, string> = {}) { this.attrs = { ...attr }; }
  createEl(tag: string, options: { text?: string; attr?: Record<string, string> } = {}) {
    const child = new FakeElement(tag, options.text, options.attr);
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  addEventListener(event: string, handler: (event: { isTrusted: boolean }) => void) { this.listeners.set(event, handler); }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  addClass() {}
  empty() { this.children = []; }
  click(isTrusted = true) { if (!this.disabled) return this.listeners.get("click")?.({ isTrusted }); }
  all(): FakeElement[] { return this.children.flatMap(child => [child, ...child.all()]); }
  label(text: string) { return this.all().find(el => el.text === text)!; }
}

vi.mock("obsidian", () => ({ Modal: class { close = vi.fn(); setTitle = vi.fn(); } }));

vi.mock("./objective-file-review", () => ({ REVIEW_MODEL_DISPLAY: "GPT-6.2 Sol", ObjectiveFileReviewError: class extends Error {} }));
import { ObjectiveFileReviewModal, renderObjectiveFilesDisclosure } from "./objective-file-review-ui";
import type { PreparedObjectiveReview, SavedObjectiveReview } from "./objective-file-review";


describe("objective file review controls", () => {
  it("keeps both actions separate from and visible with the collapsed, lazy Files list", () => {
    const parent = new FakeElement();
    const review = vi.fn();
    const render = vi.fn();
    renderObjectiveFilesDisclosure(parent as never, { count: 0, openReview: review }, render);
    expect(render).not.toHaveBeenCalled();
    expect(parent.label("Files · 0").attrs["aria-expanded"]).toBe("false");
    parent.label("Review Files").click();
    parent.label("View Review").click();
    expect(review.mock.calls).toEqual([["review"], ["view"]]);
    expect(parent.label("Files · 0").attrs["aria-expanded"]).toBe("false");
    expect(render).not.toHaveBeenCalled();
    parent.label("Files · 0").click();
    expect(parent.label("Files · 0").attrs["aria-expanded"]).toBe("true");
    expect(render).toHaveBeenCalledOnce();
    parent.label("Files · 0").click();
    parent.label("Files · 0").click();
    expect(render).toHaveBeenCalledOnce();
  });
});

const target = { id: "fixture-only", observedPath: "Objectives/Fixture/Fixture.md" };
const changes = { added: ["Subfolder/fixture.md"], changed: [], removed: [] };
const sources = [
  { id: "s1", path: "Subfolder/fixture.md", state: "included" },
  { id: "s2", path: "other.file", state: "unsupported" },
] as const;
const plan = {
  title: "Synthetic objective", sources: [...sources], changes, toSend: ["Subfolder/fixture.md"],
  noOp: false, willContactOpenAI: true, hasPrior: false,
} as PreparedObjectiveReview;
const unsafeText = '<img src="https://example.invalid/track"><script>alert(1)</script>';
const saved = {
  reviewedAt: "2026-11-23T00:00:00Z", model: "gpt-6.2-sol", sources: [...sources], changes,
  report: {
    goal: [], status: [], updates: [], blockers: [], decisions: [], gaps: [],
    nextSteps: [{ text: unsafeText, evidence: ["s1"], kind: "recommendation", rationale: "Known dependency", owner: "", due: "" }],
    analysis: [{ text: "Cross-file conflict", evidence: ["s1"], kind: "inference" }],
  },
  // The UI only receives a validated saved-view projection; the storage-only fields are not used.
} as unknown as SavedObjectiveReview;

function modalFixture(mode: "review" | "view" = "review", overrides: Partial<{ preview: typeof plan; failure: Error }> = {}) {
  const service = {
    prepare: vi.fn(async () => overrides.preview ?? plan),
    view: vi.fn(async () => saved),
    run: vi.fn(async () => {
      if (overrides.failure) throw overrides.failure;
      return { kind: "saved" as const, review: saved };
    }),
  };
  const modal = new ObjectiveFileReviewModal({} as never, service, target, mode);
  const content = new FakeElement();
  Object.assign(modal, { contentEl: content, modalEl: new FakeElement() });
  modal.onOpen();
  return { service, modal, content };
}

describe("ObjectiveFileReviewModal", () => {
  it("prepares locally, discloses collection and usage, and needs a trusted confirm click", async () => {
    const { content, service } = modalFixture();
    await vi.waitFor(() => expect(content.label("Send to OpenAI")).toBeDefined());
    expect(service.prepare).toHaveBeenCalledExactlyOnceWith(target);
    expect(service.run).not.toHaveBeenCalled();
    expect(content.all().some(el => el.text.includes("Complete PDFs") && el.text.includes("API charges"))).toBe(true);
    content.label("Send to OpenAI").click(false);
    expect(service.run).not.toHaveBeenCalled();
    content.label("Send to OpenAI").click();
    await vi.waitFor(() => expect(content.label("Review saved.")).toBeDefined());
    expect(service.run).toHaveBeenCalledExactlyOnceWith(plan);
  });

  it("viewing a saved review never inspects files or contacts OpenAI; model output stays text", async () => {
    const { content, service } = modalFixture("view");
    await vi.waitFor(() => expect(content.label("Next steps")).toBeDefined());
    expect(service.view).toHaveBeenCalledExactlyOnceWith(target);
    expect(service.prepare).not.toHaveBeenCalled();
    expect(service.run).not.toHaveBeenCalled();
    const headings = content.all().filter(el => el.tag === "h3").map(el => el.text);
    expect(headings).toEqual(["Next steps", "Analysis", "Coverage and sources"]);
    expect(content.label(unsafeText).tag).toBe("p");
    expect(content.all().some(el => ["img", "script", "a"].includes(el.tag))).toBe(false);
    expect(content.label("Sources: Subfolder/fixture.md")).toBeDefined();
    expect(content.label("other.file · Unsupported format")).toBeDefined();
  });

  it("loads the previous review on no-op without invoking run", async () => {
    const { content, service } = modalFixture("review", { preview: { ...plan, noOp: true, hasPrior: true } });
    await vi.waitFor(() => expect(content.label("No changes found. Nothing was sent to OpenAI.")).toBeDefined());
    expect(service.view).toHaveBeenCalledOnce();
    expect(service.run).not.toHaveBeenCalled();
  });

  it("does not render arbitrary error text and keeps a link to the prior saved review", async () => {
    const { content, service } = modalFixture("review", {
      preview: { ...plan, hasPrior: true }, failure: new Error(unsafeText),
    });
    await vi.waitFor(() => expect(content.label("Send to OpenAI")).toBeDefined());
    content.label("Send to OpenAI").click();
    await vi.waitFor(() => expect(content.label("View saved review")).toBeDefined());
    expect(content.label(unsafeText)).toBeUndefined();
    content.label("View saved review").click();
    await vi.waitFor(() => expect(content.label("Next steps")).toBeDefined());
    expect(service.view).toHaveBeenCalledOnce();
  });
});
