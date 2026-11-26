import { App, Modal } from "obsidian";
import {
  REVIEW_MODEL_DISPLAY,
  ObjectiveFileReviewError,
  type ObjectiveFileReviewService,
  type PreparedObjectiveReview,
  type ReviewFact,
  type ReviewSource,
  type ReviewStep,
  type ReviewTarget,
  type SavedObjectiveReview,
} from "./objective-file-review";

export type ObjectiveFileReviewMode = "review" | "view";

export function renderObjectiveFileReviewActions(
  parent: HTMLElement,
  open: (mode: ObjectiveFileReviewMode) => void,
  openChat?: () => void
): void {
  const actions = parent.createDiv({
    cls: "fjg-objective-review-actions",
    attr: { role: "group", "aria-label": "Objective file review" }
  });
  if (openChat) {
    const chat = actions.createEl("button", { text: "Chat with this objective", attr: { type: "button" } });
    chat.addEventListener("click", openChat);
  }
  for (const [label, mode] of [["Review Files", "review"], ["View Review", "view"]] as const) {
    const button = actions.createEl("button", { text: label, attr: { type: "button" } });
    button.addEventListener("click", () => open(mode));
  }
}

let nextFilesRegion = 0;

export function renderObjectiveFilesDisclosure(
  parent: HTMLElement,
  options: {
    count: number;
    openReview: (mode: ObjectiveFileReviewMode) => void;
    openChat?: () => void;
    initiallyOpen?: boolean;
    onToggle?: (open: boolean) => void;
  },
  render: (parent: HTMLElement) => void,
): void {
  const region = parent.createEl("section", { cls: "fjg-objective-files" });
  const header = region.createDiv({ cls: "fjg-objective-files-heading" });
  const regionId = `fjg-objective-files-content-${++nextFilesRegion}`;
  const toggle = header.createEl("button", {
    cls: "fjg-objective-files-toggle",
    text: `Files · ${options.count}`,
    attr: { type: "button", "aria-controls": regionId, "aria-expanded": "false" }
  });
  renderObjectiveFileReviewActions(header, options.openReview, options.openChat);
  const list = region.createDiv({ cls: "fjg-objective-files-content", attr: { id: regionId } });
  let expanded = false, mounted = false;
  const update = (open: boolean) => {
    expanded = open;
    toggle.setAttribute("aria-expanded", String(open));
    list.hidden = !open;
    if (open && !mounted) {
      mounted = true;
      render(list);
    }
  };
  update(options.initiallyOpen === true);
  toggle.addEventListener("click", () => {
    update(!expanded);
    options.onToggle?.(expanded);
  });
}

const SOURCE_LABEL: Record<ReviewSource["state"], string> = {
  included: "Included",
  unsupported: "Unsupported format",
  empty: "No extractable text",
  unreadable: "Could not read",
  too_large: "Above the per-file limit",
  budget: "Outside the review size budget",
};

const FACT_LABEL: Record<ReviewFact["kind"], string> = {
  fact: "Evidence",
  inference: "Inference",
  recommendation: "Recommendation",
  question: "Open question",
};

type ReviewService = Pick<ObjectiveFileReviewService, "prepare" | "view" | "run">;

export class ObjectiveFileReviewModal extends Modal {
  private generation = 0;
  private running = false;
  private title = "";

  constructor(
    app: App,
    private readonly service: ReviewService,
    private readonly target: ReviewTarget,
    private readonly mode: ObjectiveFileReviewMode,
  ) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("fjg-objective-review-modal");
    this.contentEl.addClass("fjg-objective-review-content");
    this.setTitle(this.mode === "review" ? "Review Files" : "View Review");
    if (this.mode === "review") void this.prepare();
    else void this.showSaved();
  }

  onClose(): void {
    this.generation++;
    this.contentEl.empty();
  }

  private button(parent: HTMLElement, label: string, action: (event: MouseEvent) => void, primary = false): HTMLButtonElement {
    const button = parent.createEl("button", {
      text: label,
      ...(primary ? { cls: "mod-cta" } : {}),
      attr: { type: "button" },
    });
    button.addEventListener("click", action);
    return button;
  }

  private controls(parent: HTMLElement = this.contentEl): HTMLElement {
    return parent.createDiv({ cls: "fjg-objective-review-actions fjg-objective-review-modal-actions" });
  }

  private status(text: string): HTMLElement {
    return this.contentEl.createEl("p", { text, cls: "fjg-objective-review-status", attr: { role: "status" } });
  }

  private failure(text: string, canView: boolean): void {
    this.contentEl.empty();
    this.contentEl.createEl("p", { text, cls: "fjg-objective-review-status", attr: { role: "alert" } });
    const actions = this.controls();
    if (canView) this.button(actions, "View saved review", () => void this.showSaved());
    this.button(actions, "Close", () => this.close());
  }

  private async prepare(): Promise<void> {
    const generation = ++this.generation;
    this.contentEl.empty();
    this.status("Checking this objective’s Files locally. Nothing has been sent.");
    try {
      const prepared = await this.service.prepare(this.target);
      if (generation !== this.generation) return;
      this.title = prepared.title;
      if (prepared.noOp) {
        await this.showSaved("No changes found. Nothing was sent to OpenAI.");
        return;
      }
      this.renderDisclosure(prepared);
    } catch (error) {
      if (generation === this.generation) this.failure(
        error instanceof ObjectiveFileReviewError ? `${error.message} Nothing was sent.`
          : "Could not prepare this objective’s file review. If this objective moved, reopen it and try again. Nothing was sent.", true);
    }
  }

  private renderDisclosure(prepared: PreparedObjectiveReview): void {
    this.contentEl.empty();
    this.contentEl.createEl("h3", { text: prepared.title, cls: "fjg-objective-review-title" });
    if (prepared.willContactOpenAI) {
      this.contentEl.createEl("p", {
        text: `This review sends eligible contents and relative file names from this objective’s Files folder, and relevant parts of a previous review to OpenAI (${REVIEW_MODEL_DISPLAY}). First reviews send supported files; later reviews send only added or changed files. Complete PDFs are sent when listed; for other supported files, extracted text is sent. Your configured API key is used; API charges may apply.`,
      });
    } else {
      this.contentEl.createEl("p", { text: "This change can be recorded locally. No file contents will be sent to OpenAI." });
    }
    this.contentEl.createEl("p", {
      text: "Only the review is written, as JSON in Objective File Reviews under your configured active tasks folder. Original files, actions, and dates are unchanged. The review may sync if your vault sync includes JSON or other file types.",
    });
    this.renderCoverage(this.contentEl, prepared.sources);
    this.renderChanges(this.contentEl, prepared.changes);
    if (prepared.toSend.length) {
      const transfer = this.contentEl.createEl("details", { cls: "fjg-objective-review-details" });
      transfer.createEl("summary", { text: `Files whose contents will be sent · ${prepared.toSend.length}` });
      const list = transfer.createEl("ul");
      for (const path of prepared.toSend) list.createEl("li", { text: path });
    }
    const actions = this.controls();
    const confirm = this.button(actions, prepared.willContactOpenAI ? "Send to OpenAI" : "Save local review",
      (event) => { if (event.isTrusted) void this.run(prepared, confirm); }, true);
    this.button(actions, "Cancel", () => this.close());
  }

  private async run(prepared: PreparedObjectiveReview, button: HTMLButtonElement): Promise<void> {
    if (this.running || button.disabled) return;
    this.running = true;
    button.disabled = true;
    const generation = ++this.generation;
    this.contentEl.empty();
    this.status(prepared.willContactOpenAI
      ? `Reviewing with ${REVIEW_MODEL_DISPLAY}. This can take a little while.`
      : "Updating the saved review locally.");
    try {
      const result = await this.service.run(prepared);
      if (this.generation !== generation) return;
      const notice = result.kind === "unchanged" ? "No changes found. Nothing was sent to OpenAI." : "Review saved.";
      this.renderReview(result.review, notice);
    } catch (error) {
      if (this.generation === generation) this.failure(
        error instanceof ObjectiveFileReviewError ? error.message
          : "The new review could not be saved. Any previous review was kept. Check the objective’s current Files and your configured OpenAI access before trying again.",
        prepared.hasPrior);
    } finally {
      this.running = false;
    }
  }

  private async showSaved(notice?: string): Promise<void> {
    const generation = ++this.generation;
    this.contentEl.empty();
    this.status("Looking for a saved review. Nothing is sent to OpenAI.");
    try {
      const review = await this.service.view(this.target);
      if (generation === this.generation) this.renderReview(review, notice);
    } catch (error) {
      if (generation === this.generation) this.failure(
        error instanceof ObjectiveFileReviewError ? `${error.message} Nothing was sent.`
          : "The saved review could not be opened. If this objective moved, reopen it and try again. Nothing was sent.", false);
    }
  }

  private renderReview(saved: SavedObjectiveReview | null, notice?: string): void {
    this.contentEl.empty();
    this.setTitle("Objective file review");
    if (this.title) this.contentEl.createEl("h3", { text: this.title, cls: "fjg-objective-review-title" });
    if (notice) this.status(notice);
    if (!saved) {
      this.contentEl.createEl("p", { text: "No saved review yet. Use Review Files on this objective when you’re ready." });
      this.button(this.controls(), "Close", () => this.close());
      return;
    }
    const time = new Date(saved.reviewedAt);
    const meta = this.contentEl.createEl("p", {
      text: Number.isFinite(time.getTime()) ? `Last reviewed ${time.toLocaleString()}` : "Last review time unavailable",
      cls: "fjg-objective-review-meta",
    });
    if (this.mode === "view") this.contentEl.createEl("p", { text: "This is the saved review, not a live check of your files.", cls: "fjg-objective-review-meta" });
    if (saved.model) meta.createEl("span", { text: ` · ${saved.model === "gpt-6.2-sol" ? REVIEW_MODEL_DISPLAY : saved.model === "local-coverage" ? "Local coverage only" : saved.model}` });
    const names = new Map(saved.sources.map(source => [source.id, source.path]));
    this.renderFacts(this.contentEl, "Next steps", saved.report.nextSteps, names, true);
    this.renderFacts(this.contentEl, "Analysis", saved.report.analysis, names);
    this.renderFacts(this.contentEl, "Goal", saved.report.goal, names);
    this.renderFacts(this.contentEl, "Current status", saved.report.status, names);
    this.renderFacts(this.contentEl, "Updates", saved.report.updates, names);
    this.renderFacts(this.contentEl, "Blockers", saved.report.blockers, names);
    this.renderFacts(this.contentEl, "Decisions", saved.report.decisions, names);
    this.renderFacts(this.contentEl, "Gaps and open questions", saved.report.gaps, names);
    this.renderCoverage(this.contentEl, saved.sources);
    this.renderChanges(this.contentEl, saved.changes);
    this.button(this.controls(), "Close", () => this.close());
  }

  private renderFacts(
    parent: HTMLElement, label: string, facts: ReviewFact[],
    names: ReadonlyMap<string, string>, steps = false,
  ): void {
    if (!facts.length && !steps) return;
    const section = parent.createEl("section", { cls: "fjg-objective-review-section" });
    section.createEl("h3", { text: label });
    if (!facts.length) {
      section.createEl("p", { text: "No supported next steps were identified." });
      return;
    }
    const list = section.createEl(steps ? "ol" : "ul", { cls: "fjg-objective-review-facts" });
    for (const fact of facts) {
      const item = list.createEl("li");
      item.createEl("span", { text: FACT_LABEL[fact.kind], cls: "fjg-objective-review-kind" });
      item.createEl("p", { text: fact.text });
      if (steps) {
        const step = fact as ReviewStep;
        item.createEl("p", {
          text: `Owner: ${step.owner || "Not established"} · Due: ${step.due || "Not established"}`,
          cls: "fjg-objective-review-meta",
        });
        if (step.rationale) item.createEl("p", { text: `Why: ${step.rationale}`, cls: "fjg-objective-review-meta" });
      }
      if (fact.evidence.length) item.createEl("p", {
        text: `Sources: ${fact.evidence.map(id => names.get(id) ?? "Unverified reference").join("; ")}`,
        cls: "fjg-objective-review-meta",
      });
    }
  }

  private renderCoverage(parent: HTMLElement, sources: ReviewSource[]): void {
    const section = parent.createEl("section", { cls: "fjg-objective-review-section" });
    section.createEl("h3", { text: "Coverage and sources" });
    const included = sources.filter(source => source.state === "included").length;
    section.createEl("p", {
      text: sources.length ? `${included} of ${sources.length} files included. ${sources.length - included} not included.`
        : "No files were found in this objective’s Files folder.",
    });
    if (!sources.length) return;
    const details = section.createEl("details", { cls: "fjg-objective-review-details" });
    details.createEl("summary", { text: "Source files and coverage details" });
    const list = details.createEl("ul");
    for (const source of sources) list.createEl("li", { text: `${source.path} · ${SOURCE_LABEL[source.state]}` });
  }

  private renderChanges(parent: HTMLElement, changes: PreparedObjectiveReview["changes"]): void {
    if (!(changes.added.length || changes.changed.length || changes.removed.length)) return;
    const details = parent.createEl("details", { cls: "fjg-objective-review-details" });
    details.createEl("summary", {
      text: `File changes · ${changes.added.length} added, ${changes.changed.length} changed, ${changes.removed.length} removed`,
    });
    for (const [label, paths] of [["Added", changes.added], ["Changed", changes.changed], ["Removed", changes.removed]] as const) {
      if (!paths.length) continue;
      details.createEl("strong", { text: label });
      const list = details.createEl("ul");
      for (const path of paths) list.createEl("li", { text: path });
    }
  }
}
