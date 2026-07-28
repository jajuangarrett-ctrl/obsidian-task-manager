import {
  App,
  Modal,
  Notice,
  setIcon
} from "obsidian";
import { statusLabel, TaskStatus } from "@fjg/task-core";
import type FjgTaskManagerPlugin from "../main";
import {
  draftTasksFromCapture,
  startVoiceRecording,
  transcribeTaskAudio,
  VoiceRecorder
} from "./openai-capture";
import {
  CAPTURE_STATUSES,
  fallbackTaskTitle,
  TaskCaptureDraft
} from "./quick-capture-model";

interface DraftFormControls {
  title: HTMLInputElement;
  details: HTMLTextAreaElement;
  status: HTMLSelectElement;
  project: HTMLSelectElement;
  due: HTMLInputElement;
  delegated: HTMLInputElement;
}

export class QuickCaptureModal extends Modal {
  private rawCapture = "";
  private drafts: TaskCaptureDraft[] = [{
    title: "",
    details: "",
    status: "do-first",
    project: "",
    due: "",
    delegatedTo: ""
  }];
  private rawInput: HTMLTextAreaElement | null = null;
  private formHeading: HTMLHeadingElement | null = null;
  private formsContainer: HTMLDivElement | null = null;
  private formControls: DraftFormControls[] = [];
  private recordButton: HTMLButtonElement | null = null;
  private draftButton: HTMLButtonElement | null = null;
  private createButton: HTMLButtonElement | null = null;
  private recorder: VoiceRecorder | null = null;
  private recording = false;
  private busy = false;
  private generatedDrafts = false;
  private detailsWereEdited = new Set<number>();

  constructor(
    app: App,
    private readonly taskPlugin: FjgTaskManagerPlugin,
    initialText = ""
  ) {
    super(app);
    this.rawCapture = initialText.trim();
    this.drafts[0].details = this.rawCapture;
  }

  onOpen(): void {
    this.modalEl.addClass("fjg-quick-capture-shell");
    this.contentEl.addClass("fjg-quick-capture");
    this.contentEl.empty();

    const header = this.contentEl.createDiv({ cls: "fjg-capture-header" });
    header.createEl("p", { text: "FJG TASK MANAGER", cls: "fjg-capture-eyebrow" });
    header.createEl("h2", { text: "Capture Tasks" });

    const captureSection = this.contentEl.createDiv({ cls: "fjg-capture-section" });
    captureSection.createEl("h3", { text: "Capture" });
    const captureCard = captureSection.createDiv({ cls: "fjg-capture-card" });
    this.rawInput = captureCard.createEl("textarea", {
      placeholder: "Type what you need to do, or dictate it.",
      attr: {
        rows: "5",
        "aria-label": "Task capture text"
      }
    });
    this.rawInput.value = this.rawCapture;
    this.rawInput.addEventListener("input", () => {
      this.rawCapture = this.rawInput?.value || "";
      if (!this.generatedDrafts && this.drafts.length === 1 && !this.detailsWereEdited.has(0)) {
        this.drafts[0].details = this.rawCapture.trim();
        if (this.formControls[0]) this.formControls[0].details.value = this.drafts[0].details;
      }
    });

    const captureActions = captureCard.createDiv({ cls: "fjg-capture-actions" });
    this.recordButton = this.iconButton(captureActions, "microphone", "Dictate", () => this.toggleRecording());
    this.recordButton.addClass("fjg-dictate-button");
    this.draftButton = this.iconButton(captureActions, "sparkles", "Draft Tasks", () => this.draftTasks());
    this.draftButton.addClass("fjg-draft-button");

    const formSection = this.contentEl.createDiv({ cls: "fjg-capture-section" });
    this.formHeading = formSection.createEl("h3", { text: "New Task" });
    this.formsContainer = formSection.createDiv({ cls: "fjg-draft-list" });
    this.renderDraftForms();

    this.createButton = this.iconButton(
      this.contentEl,
      "circle-plus",
      "Create Task",
      () => this.createTasks()
    );
    this.createButton.addClass("fjg-create-task-button", "mod-cta");
    this.updateCreateButton();

    setTimeout(() => this.rawInput?.focus(), 0);
  }

  private async toggleRecording(): Promise<void> {
    if (this.busy || !this.recordButton) return;
    if (!this.recording) {
      const apiKey = await this.taskPlugin.resolveOpenAiApiKey();
      if (!apiKey) {
        new Notice("Add an OpenAI API key in FJG Task Manager settings before dictating.");
        return;
      }
      try {
        this.recorder = await startVoiceRecording();
        this.recording = true;
        this.setButton(this.recordButton, "square", "Stop");
        this.recordButton.addClass("is-recording");
      } catch (error) {
        new Notice(`Microphone error: ${messageFor(error)}`, 8000);
      }
      return;
    }

    this.recording = false;
    this.recordButton.removeClass("is-recording");
    await this.withBusy(async () => {
      this.setButton(this.recordButton!, "loader-circle", "Transcribing…");
      const audio = await this.recorder!.stop();
      this.recorder = null;
      const transcript = await transcribeTaskAudio(
        audio,
        await this.taskPlugin.resolveOpenAiApiKey(),
        this.taskPlugin.settings.transcriptionModel
      );
      this.rawCapture = mergeText(this.rawCapture, transcript);
      if (this.rawInput) this.rawInput.value = this.rawCapture;
      if (!this.generatedDrafts && this.drafts.length === 1 && !this.detailsWereEdited.has(0)) {
        this.drafts[0].details = this.rawCapture;
        if (this.formControls[0]) this.formControls[0].details.value = this.drafts[0].details;
      }
      if (this.taskPlugin.settings.autoDraftAfterTranscription) {
        await this.requestDraft(await this.taskPlugin.resolveOpenAiApiKey());
      }
    }, "Voice capture failed");
    this.setButton(this.recordButton, "microphone", "Dictate");
  }

  private async draftTasks(showFailure = true): Promise<void> {
    if (this.busy) return;
    if (!this.rawCapture.trim()) {
      new Notice("Type or dictate the task before drafting.");
      return;
    }
    const apiKey = await this.taskPlugin.resolveOpenAiApiKey();
    if (!apiKey) {
      new Notice("Add an OpenAI API key in FJG Task Manager settings to draft task fields.");
      return;
    }
    await this.withBusy(async () => {
      await this.requestDraft(apiKey);
    }, showFailure ? "Task drafting failed" : "Voice capture failed");
  }

  private async requestDraft(apiKey: string): Promise<void> {
    if (this.draftButton) this.setButton(this.draftButton, "loader-circle", "Drafting…");
    try {
      const drafts = await draftTasksFromCapture({
        apiKey,
        model: this.taskPlugin.settings.openAiModel,
        rawCapture: this.rawCapture,
        projects: this.taskPlugin.projectNames()
      });
      this.generatedDrafts = true;
      this.detailsWereEdited.clear();
      this.drafts = drafts;
      this.renderDraftForms();
      new Notice(
        drafts.length === 1
          ? "Drafted 1 task. Review it before creating."
          : `Drafted ${drafts.length} tasks. Review each task before creating.`
      );
    } finally {
      if (this.draftButton) this.setButton(this.draftButton, "sparkles", "Draft Tasks");
    }
  }

  private renderDraftForms(): void {
    if (!this.formsContainer) return;
    this.formsContainer.empty();
    this.formsContainer.classList.toggle("is-multiple", this.drafts.length > 1);
    this.formControls = [];
    if (this.formHeading) {
      this.formHeading.setText(this.drafts.length === 1 ? "New Task" : `New Tasks (${this.drafts.length})`);
    }

    this.drafts.forEach((draft, index) => {
      const formCard = this.formsContainer!.createDiv({ cls: "fjg-task-form-card" });
      if (this.drafts.length > 1) {
        const taskHeader = formCard.createDiv({ cls: "fjg-draft-item-header" });
        taskHeader.createEl("h4", { text: `Task ${index + 1}` });
        const removeButton = this.iconButton(taskHeader, "trash-2", "Remove", () => this.removeDraft(index));
        removeButton.addClass("fjg-remove-draft-button");
        removeButton.setAttribute("aria-label", `Remove task ${index + 1}`);
      }

      const title = this.inputRow(formCard, "Task title", "text");
      title.placeholder = "What needs to be done?";
      title.value = draft.title;
      title.addEventListener("input", () => this.drafts[index].title = title.value);

      const status = this.selectRow(formCard, "Status");
      for (const option of CAPTURE_STATUSES) {
        status.createEl("option", {
          value: option,
          text: statusLabel(option)
        });
      }
      status.value = draft.status;
      status.addEventListener("change", () => {
        this.drafts[index].status = status.value as TaskStatus || "do-first";
      });

      const project = this.selectRow(formCard, "Project");
      project.createEl("option", { value: "", text: "No Project" });
      for (const projectName of this.taskPlugin.projectNames()) {
        project.createEl("option", { value: projectName, text: projectName });
      }
      project.value = draft.project;
      project.addEventListener("change", () => this.drafts[index].project = project.value);

      const due = this.inputRow(formCard, "Due date", "date");
      due.value = draft.due;
      due.addEventListener("input", () => this.drafts[index].due = due.value);

      const detailsSection = formCard.createEl("details", { cls: "fjg-capture-more" });
      detailsSection.open = Boolean(draft.delegatedTo);
      const summary = detailsSection.createEl("summary");
      const summaryIcon = summary.createSpan({ cls: "fjg-capture-summary-icon" });
      setIcon(summaryIcon, "sliders-horizontal");
      summary.createSpan({ text: "More details" });

      const moreFields = detailsSection.createDiv({ cls: "fjg-capture-more-fields" });
      const detailsLabel = moreFields.createEl("label", { text: "Task details" });
      const details = moreFields.createEl("textarea", {
        attr: { rows: "4", "aria-label": `Task ${index + 1} details` }
      });
      detailsLabel.htmlFor = this.assignId(details, `details-${index + 1}`);
      details.value = draft.details;
      details.addEventListener("input", () => {
        this.detailsWereEdited.add(index);
        this.drafts[index].details = details.value;
      });

      const delegated = this.inputRow(moreFields, "Delegated to", "text");
      delegated.placeholder = "Person responsible";
      delegated.value = draft.delegatedTo;
      delegated.addEventListener("input", () => this.drafts[index].delegatedTo = delegated.value);

      this.formControls.push({ title, details, status, project, due, delegated });
    });
    this.updateCreateButton();
    if (this.busy) this.setControlsDisabled(true);
  }

  private removeDraft(index: number): void {
    if (this.busy || this.drafts.length <= 1) return;
    this.syncDraftsFromForms();
    this.drafts.splice(index, 1);
    this.detailsWereEdited.clear();
    this.generatedDrafts = true;
    this.renderDraftForms();
  }

  private syncDraftsFromForms(): void {
    this.drafts = this.drafts.map((draft, index) => {
      const controls = this.formControls[index];
      if (!controls) return draft;
      return {
        title: controls.title.value.trim(),
        details: controls.details.value.trim(),
        status: controls.status.value as TaskStatus || "do-first",
        project: controls.project.value,
        due: controls.due.value,
        delegatedTo: controls.delegated.value.trim()
      };
    });
  }

  private async createTasks(): Promise<void> {
    if (this.busy) return;
    this.syncDraftsFromForms();
    const drafts = this.drafts.map((draft) => ({
      ...draft,
      title: draft.title.trim(),
      details: draft.details.trim(),
      delegatedTo: draft.delegatedTo.trim()
    }));
    if (drafts.length === 1 && !drafts[0].title) {
      drafts[0].title = fallbackTaskTitle(this.rawCapture);
      if (this.formControls[0]) this.formControls[0].title.value = drafts[0].title;
    }
    const missingTitle = drafts.findIndex((draft) => !draft.title);
    if (missingTitle >= 0) {
      new Notice(`Add a title for task ${missingTitle + 1} before creating the tasks.`);
      this.formControls[missingTitle]?.title.focus();
      return;
    }
    await this.withBusy(async () => {
      await this.taskPlugin.createCapturedTasks(drafts);
      this.close();
    }, drafts.length === 1 ? "Task creation failed" : "Task creation failed; no tasks were kept");
  }

  private updateCreateButton(): void {
    if (!this.createButton) return;
    const count = this.drafts.length;
    this.setButton(
      this.createButton,
      count === 1 ? "circle-plus" : "list-plus",
      count === 1 ? "Create Task" : `Create ${count} Tasks`
    );
  }

  private async withBusy(work: () => Promise<void>, failurePrefix: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setControlsDisabled(true);
    try {
      await work();
    } catch (error) {
      new Notice(`${failurePrefix}: ${messageFor(error)}`, 10000);
    } finally {
      this.busy = false;
      this.setControlsDisabled(false);
    }
  }

  private setControlsDisabled(disabled: boolean): void {
    for (const control of this.contentEl.querySelectorAll("button, input, textarea, select")) {
      if (
        control instanceof HTMLButtonElement
        || control instanceof HTMLInputElement
        || control instanceof HTMLTextAreaElement
        || control instanceof HTMLSelectElement
      ) {
        control.disabled = disabled;
      }
    }
  }

  private inputRow(parent: HTMLElement, label: string, type: string): HTMLInputElement {
    const row = parent.createDiv({ cls: "fjg-capture-form-row" });
    const labelEl = row.createEl("label", { text: label });
    const input = row.createEl("input", { type });
    labelEl.htmlFor = this.assignId(input, label.toLowerCase().replace(/\s+/g, "-"));
    return input;
  }

  private selectRow(parent: HTMLElement, label: string): HTMLSelectElement {
    const row = parent.createDiv({ cls: "fjg-capture-form-row" });
    const labelEl = row.createEl("label", { text: label });
    const select = row.createEl("select");
    labelEl.htmlFor = this.assignId(select, label.toLowerCase().replace(/\s+/g, "-"));
    return select;
  }

  private assignId(element: HTMLElement, suffix: string): string {
    const id = `fjg-quick-capture-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
    element.id = id;
    return id;
  }

  private iconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    action: () => void | Promise<void>
  ): HTMLButtonElement {
    const button = parent.createEl("button", { attr: { type: "button" } });
    this.setButton(button, icon, label);
    button.addEventListener("click", () => void action());
    return button;
  }

  private setButton(button: HTMLButtonElement, icon: string, label: string): void {
    button.empty();
    const iconEl = button.createSpan({ cls: "fjg-capture-button-icon" });
    setIcon(iconEl, icon);
    button.createSpan({ text: label });
  }

  onClose(): void {
    this.recorder?.cancel();
    this.recorder = null;
    this.contentEl.empty();
  }
}

function mergeText(existing: string, addition: string): string {
  const left = existing.trim();
  const right = addition.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left}\n${right}`;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
