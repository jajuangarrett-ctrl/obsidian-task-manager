import { App, FuzzySuggestModal, Modal, Notice, Setting, TFile } from "obsidian";
import { TASK_STATUSES, statusLabel, TaskSubtask } from "@fjg/task-core";
import type { TaskWorkspaceService } from "./workspace-service";

export class SubtaskEditModal extends Modal {
  constructor(app: App, private sub: TaskSubtask | null, private save: (title: string, due: string, notes: string, status: TaskSubtask["status"]) => Promise<void>) { super(app); }
  onOpen(): void {
    this.setTitle(this.sub ? "Edit subtask" : "Add subtask");
    let title = this.sub?.title || "", due = this.sub?.due || "", notes = this.sub?.notes || "";
    let status = this.sub?.status || "do-soon";
    new Setting(this.contentEl).setName("Title").addText((text) => text.setValue(title).onChange((value) => title = value));
    new Setting(this.contentEl).setName("Status").addDropdown((select) => {
      for (const value of TASK_STATUSES.filter((item) => item !== "archived")) select.addOption(value, statusLabel(value));
      select.setValue(status).onChange((value) => status = value as typeof status);
    });
    new Setting(this.contentEl).setName("Due date").addText((text) => { text.inputEl.type = "date"; text.setValue(due).onChange((value) => due = value); });
    new Setting(this.contentEl).setName("Notes").addTextArea((text) => { text.inputEl.rows = 5; text.setValue(notes).onChange((value) => notes = value); });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Save subtask").setCta().onClick(async () => {
        button.setDisabled(true);
        try { await this.save(title, due, notes, status); this.close(); }
        catch (error) { new Notice(String(error)); }
        finally { button.setDisabled(false); }
      }));
  }
}

export class SubtaskVaultFileModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private attach: (file: TFile) => Promise<void>) { super(app); this.setPlaceholder("Copy an existing vault file into this subtask"); }
  getItems(): TFile[] { return this.app.vault.getFiles(); }
  getItemText(file: TFile): string { return file.path; }
  onChooseItem(file: TFile): void { void this.attach(file).catch((error) => new Notice(String(error))); }
}

export class ConvertSubtasksModal extends Modal {
  constructor(app: App, private service: TaskWorkspaceService, private refreshed: () => void, private initialId = "") { super(app); }
  onOpen(): void {
    this.setTitle("Convert tasks to subtasks");
    const tasks = this.service.list().filter((task) => !task.archived).sort((a, b) => a.record.title.localeCompare(b.record.title));
    let parentId = "";
    const selected = new Set(this.initialId ? [this.initialId] : []);
    new Setting(this.contentEl).setName("Parent task").addDropdown((select) => {
      select.addOption("", "Choose parent…");
      for (const task of tasks) select.addOption(task.record.task_id, `${task.record.title} · ${task.record.project || "No project"} · ${task.taskFile.path}`);
      select.onChange((value) => { parentId = value; selected.delete(value); render(); });
    });
    const search = this.contentEl.createEl("input", { type: "search", placeholder: "Find tasks to convert", attr: { "aria-label": "Find tasks to convert" } });
    const list = this.contentEl.createDiv({ cls: "fjg-convert-list" });
    const preview = this.contentEl.createDiv();
    const render = () => {
      list.empty(); preview.empty();
      for (const task of tasks.filter((item) => item.record.task_id !== parentId && item.record.title.toLowerCase().includes(search.value.toLowerCase()))) {
        new Setting(list).setName(task.record.title).setDesc(task.taskFile.path).addToggle((toggle) => toggle.setValue(selected.has(task.record.task_id)).onChange((value) => {
          if (value) selected.add(task.record.task_id); else selected.delete(task.record.task_id);
          renderPreview();
        }));
      }
      renderPreview();
    };
    const renderPreview = () => {
      preview.empty();
      preview.createEl("p", { text: `${selected.size} selected. Their notes, due dates, statuses and update histories will carry over. Owned attachment folders move to the parent's Files/Subtasks area. Original tasks are archived. Shared external references remain in those original records.` });
      for (const id of selected) {
        const task = tasks.find((item) => item.record.task_id === id);
        if (task) preview.createEl("p", { text: `${task.record.title} → ${tasks.find((item) => item.record.task_id === parentId)?.record.title || "Choose parent"}` });
      }
    };
    search.addEventListener("input", render);
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Convert reviewed tasks").setCta().onClick(async () => {
        if (!parentId || !selected.size) { new Notice("Choose a parent and at least one task."); return; }
        if ([...selected].some((id) => this.service.getById(id).record.subtasks.length)) { new Notice("Selected tasks with existing subtasks cannot be nested again."); return; }
        button.setDisabled(true);
        let completed = 0;
        try {
          for (const id of [...selected]) { await this.service.convertTaskToSubtask(id, parentId); selected.delete(id); completed++; }
          new Notice(`Converted ${completed} tasks to subtasks.`); this.close();
        } catch (error) { new Notice(`${completed} converted. Remaining tasks were not converted: ${String(error)}`, 12000); }
        finally { this.refreshed(); button.setDisabled(false); render(); }
      }));
    render();
  }
}

export class PromoteSubtaskModal extends Modal {
  constructor(app: App, private title: string, private promote: () => Promise<void>) { super(app); }
  onOpen(): void {
    this.setTitle(`Promote ${this.title}`);
    this.contentEl.createEl("p", { text: "Create a full task with this subtask's status, due date, notes and preserved history. Its attachment folder will move into the new task's Files folder, and the subtask will leave the parent card." });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Promote to task").setCta().onClick(async () => {
        b.setDisabled(true);
        try { await this.promote(); this.close(); } catch (error) { new Notice(String(error)); } finally { b.setDisabled(false); }
      }));
  }
}
