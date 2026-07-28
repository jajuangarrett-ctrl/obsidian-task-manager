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
      if (!this.detailsWereEdited) {
        this.value.details = this.rawCapture;
        if (this.detailsInput) this.detailsInput.value = this.value.details;
      }
      if (this.taskPlugin.settings.autoDraftAfterTranscription) {
        await this.requestDraft(await this.taskPlugin.resolveOpenAiApiKey());
      }
    }, "Voice capture failed");
    this.setButton(this.recordButton, "microphone", "Dictate");
  }

  private async draftTask(showFailure = true): Promise<void> {
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
    if (this.draftButton) this.setButton(this.draftButton, "sparkles", "Draft Task");
  }

  private async requestDraft(apiKey: string): Promise<void> {
    if (this.draftButton) this.setButton(this.draftButton, "loader-circle", "Drafting…");
    const draft = await draftTaskFromCapture({
      apiKey,
      model: this.taskPlugin.settings.openAiModel,
      rawCapture: this.rawCapture,
      projects: this.taskPlugin.projectNames()
    });
    this.applyDraft(draft);
  }

  private applyDraft(draft: TaskCaptureDraft): void {
    this.value = draft;
    if (this.titleInput) this.titleInput.value = draft.title;
    if (this.detailsInput) this.detailsInput.value = draft.details;
    if (this.statusInput) this.statusInput.value = draft.status;
    if (this.projectInput) this.projectInput.value = draft.project;
    if (this.dueInput) this.dueInput.value = draft.due;
    if (this.delegatedInput) this.delegatedInput.value = draft.delegatedTo;
    if (draft.delegatedTo && this.detailsSection) this.detailsSection.open = true;
  }

  private async createTask(): Promise<void> {
    if (this.busy) return;
    this.value.title = this.titleInput?.value.trim() || fallbackTaskTitle(this.rawCapture);
    this.value.details = this.detailsInput?.value.trim() || this.rawCapture.trim();
    this.value.project = this.projectInput?.value || "";
    this.value.due = this.dueInput?.value || "";
    this.value.delegatedTo = this.delegatedInput?.value.trim() || "";
    this.value.status = this.statusInput?.value as TaskStatus || "do-first";
    if (!this.value.title) {
      new Notice("Add a task title before creating the task.");
      this.titleInput?.focus();
      return;
    }
    await this.withBusy(async () => {
      await this.taskPlugin.createCapturedTask(this.value);
      this.close();
    }, "Task creation failed");
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
    for (const control of [
      this.recordButton,
      this.draftButton,
      this.createButton
    ]) {
      if (control) control.disabled = disabled;
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
