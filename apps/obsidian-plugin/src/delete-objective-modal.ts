import { App, Modal, Notice, Setting, type ButtonComponent } from "obsidian";
import type { DeleteConfirmation, DeletePreview } from "./objective-delete";

export class DeleteObjectiveModal extends Modal {
  constructor(app: App, private preview: DeletePreview, private submit: (confirmation: DeleteConfirmation) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    const p = this.preview;
    this.setTitle(`Delete objective: ${p.title}`);
    this.contentEl.createEl("p", {
      text: "Move to Trash removes only the objective’s listed folders and files from their current locations. The vault’s .trash folder is recoverable, but it isn’t a permanent backup. Other notes and external files stay in place."
    });
    const list = (title: string, items: string[], open = false) => {
      const details = this.contentEl.createEl("details");
      details.open = open;
      details.createEl("summary", { text: `${title} (${items.length})` });
      const entries = details.createEl("ul");
      for (const text of items) entries.createEl("li", { text });
    };
    list("Owned folders", p.roots);
    list("Files, including history and hidden files", p.files.map(f => f.path));
    list("Actions", p.actions);
    list("External linked files (kept)", p.externalFiles);
    if (p.linkWarnings.length) {
      list("Links that may break (the linking notes are kept)", p.linkWarnings.map(({ source, target }) => `${source} → ${target}`), true);
    }
    list("Notes linking here (kept)", p.incoming);
    if (p.blockers.length) {
      this.contentEl.createEl("h3", { text: "Deletion blocked" });
      list("Resolve these dependencies before deleting", p.blockers, true);
      new Setting(this.contentEl).addButton(b => b.setButtonText("Close").onClick(() => this.close()));
      return;
    }

    const errorText = this.contentEl.createEl("p", { attr: { role: "alert" } });
    let acknowledgeLinks = false;
    let busy = false;
    let confirm: ButtonComponent;
    const update = () => confirm?.setDisabled(busy || !acknowledgeLinks);
    new Setting(this.contentEl)
      .setName("I reviewed what will go to Trash")
      .setDesc(p.linkWarnings.length ? "I understand the links shown above may stop working." : "I understand this removes the listed objective files from their current locations.")
      .addToggle(t => t.onChange(value => { acknowledgeLinks = value; update(); }));
    new Setting(this.contentEl)
      .addButton(b => b.setButtonText("Cancel").onClick(() => { if (!busy) this.close(); }))
      .addButton(b => {
        confirm = b;
        b.setButtonText("Move to Trash").setWarning().setDisabled(true).onClick(async () => {
          if (busy || !acknowledgeLinks) return;
          busy = true;
          errorText.setText("");
          update();
          try {
            await this.submit({ acknowledgeLinks });
            this.close();
          } catch (error) {
            errorText.setText(String(error));
            new Notice(String(error), 15000);
          } finally {
            busy = false;
            update();
          }
        });
      });
  }

  onClose(): void { this.contentEl.empty(); }
}
