import { App, Modal, Notice, Setting } from "obsidian";
import {
  prepareUnifiedCapture,
  type UnifiedCaptureAction,
  type UnifiedCaptureRequest
} from "./unified-capture-model";

export class UnifiedCaptureModal extends Modal {
  private action: UnifiedCaptureAction = "new-task";
  private text = "";
  private textArea!: HTMLTextAreaElement;
  private continueButton!: HTMLButtonElement;

  constructor(
    app: App,
    private readonly continueToReview: (request: UnifiedCaptureRequest) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("fjg-unified-capture-modal");
    this.setTitle("Capture to FJG Vault");
    this.contentEl.createEl("p", {
      text: "Paste or type the source text, choose an action, then continue to its normal review screen. Nothing is saved from this window.",
      cls: "fjg-unified-capture-intro"
    });

    new Setting(this.contentEl)
      .setName("Action")
      .setDesc("Choose the reviewed workflow to open.")
      .addDropdown((dropdown) => dropdown
        .addOption("new-task", "Create new task")
        .addOption("agenda-item", "Create agenda item")
        .addOption("task-update", "Update existing task")
        .setValue(this.action)
        .onChange((value) => {
          this.action = value as UnifiedCaptureAction;
        }));

    new Setting(this.contentEl)
      .setName("Source text")
      .setDesc("Review and edit this text again in the destination workflow.")
      .addTextArea((area) => {
        this.textArea = area.inputEl;
        area.inputEl.rows = 10;
        area.inputEl.placeholder = "Paste or type the task, agenda item, or update…";
        area.inputEl.setAttribute("aria-label", "Capture source text");
        area.onChange((value) => {
          this.text = value;
          this.syncContinueState();
        });
      });

    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText("Paste Clipboard")
        .onClick(() => void this.pasteClipboard()))
      .addButton((button) => {
        button
          .setButtonText("Continue to Review")
          .setCta()
          .setDisabled(true)
          .onClick(() => this.continue());
        this.continueButton = button.buttonEl;
      });

    window.setTimeout(() => this.textArea.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async pasteClipboard(): Promise<void> {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) {
        new Notice("The clipboard does not contain text.");
        return;
      }
      this.text = clipboardText;
      this.textArea.value = clipboardText;
      this.textArea.dispatchEvent(new Event("input", { bubbles: true }));
      this.syncContinueState();
      this.textArea.focus();
    } catch (error) {
      console.error("[FJG Task Manager] Clipboard read failed", error);
      new Notice("Obsidian could not read the clipboard. Paste into the text box with Command-V.", 8000);
    }
  }

  private continue(): void {
    try {
      const request = prepareUnifiedCapture(this.action, this.text);
      this.close();
      window.setTimeout(() => this.continueToReview(request), 0);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  private syncContinueState(): void {
    if (this.continueButton) this.continueButton.disabled = !this.text.trim();
  }
}
