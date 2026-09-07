import { App, FuzzySuggestModal, Modal, Notice, Setting, TFile } from "obsidian";
import { TASK_STATUSES, statusLabel, TaskSubtask } from "@fjg/task-core";
import type { TaskWorkspaceService } from "./workspace-service";

export class SubtaskEditModal extends Modal {
  constructor(app: App, private sub: TaskSubtask | null, private save: (title: string, due: string, notes: string, status: TaskSubtask["status"], parentId?: string) => Promise<void>, private captureService?: TaskWorkspaceService) { super(app); }
  onOpen(): void {
    this.setTitle(this.captureService ? "Capture action" : this.sub ? "Edit action" : "Add action");
    let parentId = "";
    if (this.captureService) {
      const service = this.captureService;
      const search = this.contentEl.createEl("input", { type: "search", placeholder: "Search objectives by title…", cls: "fjg-parent-search", attr: { "aria-label": "Search parent objectives" } });
      const choice = this.contentEl.createDiv({ cls: "fjg-parent-choice", attr: { "aria-live": "polite" } });
      const results = this.contentEl.createDiv({ cls: "fjg-parent-results" });
      choice.setText("Choose the objective this action belongs to.");
      search.addEventListener("input", () => {
        parentId = ""; results.empty();
        const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (!terms.length) { choice.setText("Choose the objective this action belongs to."); return; }
        const matches = service.list().filter((task) => !task.archived && terms.every((term) => `${task.record.title} ${task.taskFile.path}`.toLowerCase().includes(term))).sort((a, b) => a.record.title.localeCompare(b.record.title));
        choice.setText(matches.length ? `${matches.length} matching ${matches.length === 1 ? "objective" : "objectives"}${matches.length > 8 ? "; showing the first 8. Keep typing to narrow the list." : "."}` : "No matching objectives. Try another title.");
        for (const task of matches.slice(0, 8)) {
          const button = results.createEl("button", { cls: "fjg-parent-result", attr: { type: "button" } });
          button.createEl("strong", { text: task.record.title });
          button.createEl("small", { text: task.taskFile.path });
          button.addEventListener("click", () => { parentId = task.record.task_id; search.value = task.record.title; results.empty(); choice.setText(`Selected objective: ${task.record.title}`); });
        }
      });
    }
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
      .addButton((button) => button.setButtonText("Save action").setCta().onClick(async () => {
        if (this.captureService && !parentId) { new Notice("Choose a parent objective from the search results."); return; }
        if (!title.trim()) { new Notice("Enter an action title."); return; }
        button.setDisabled(true);
        try { await this.save(title, due, notes, status, parentId || undefined); this.close(); }
        catch (error) { new Notice(String(error)); }
        finally { button.setDisabled(false); }
      }));
  }
}

export class SubtaskVaultFileModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private attach: (file: TFile) => Promise<void>) { super(app); this.setPlaceholder("Copy an existing vault file into this action"); }
  getItems(): TFile[] { return this.app.vault.getFiles(); }
  getItemText(file: TFile): string { return file.path; }
  onChooseItem(file: TFile): void { void this.attach(file).catch((error) => new Notice(String(error))); }
}

export class ConvertSubtasksModal extends Modal {
  constructor(app: App, private service: TaskWorkspaceService, private refreshed: () => void, private initialId = "") { super(app); }
  onOpen(): void {
    this.setTitle("Convert objectives to actions");
    const tasks = this.service.list().filter((task) => !task.archived).sort((a, b) => a.record.title.localeCompare(b.record.title));
    let parentId = "";
    const selected = new Set(this.initialId ? [this.initialId] : []);
    const parentLabel = this.contentEl.createEl("label", { text: "Parent objective" });
    const parentSearch = this.contentEl.createEl("input", {
      type: "search", placeholder: "Search parent objectives by title…",
      cls: "fjg-parent-search", attr: { "aria-label": "Search parent objectives", id: "fjg-parent-search" }
    });
    parentLabel.htmlFor = "fjg-parent-search";
    const parentChoice = this.contentEl.createDiv({ cls: "fjg-parent-choice", attr: { "aria-live": "polite" } });
    const parentResults = this.contentEl.createDiv({ cls: "fjg-parent-results" });
    const renderParents = () => {
      parentResults.empty(); parentChoice.empty();
      if (parentId) {
        parentChoice.createSpan({ text: `Selected parent: ${tasks.find((task) => task.record.task_id === parentId)?.record.title}` });
        return;
      }
      const terms = parentSearch.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      if (!terms.length) { parentChoice.setText("Type to find a parent, then select a result."); return; }
      const matches = tasks.filter((task) => !selected.has(task.record.task_id) && terms.every((term) =>
        `${task.record.title} ${task.taskFile.path}`.toLowerCase().includes(term)));
      parentChoice.setText(matches.length ? `${matches.length} matching ${matches.length === 1 ? "objective" : "objectives"}${matches.length > 8 ? "; showing the first 8. Keep typing to narrow the list." : "."}` : "No matching objectives. Try another title.");
      for (const task of matches.slice(0, 8)) {
        const result = parentResults.createEl("button", { cls: "fjg-parent-result", attr: { type: "button" } });
        result.createEl("strong", { text: task.record.title });
        result.createEl("small", { text: task.taskFile.path });
        result.addEventListener("click", () => {
          parentId = task.record.task_id; parentSearch.value = task.record.title;
          renderParents(); render();
        });
      }
    };
    parentSearch.addEventListener("input", () => { parentId = ""; renderParents(); renderPreview(); });
    const search = this.contentEl.createEl("input", { type: "search", placeholder: "Find objectives to convert", attr: { "aria-label": "Find objectives to convert" } });
    const list = this.contentEl.createDiv({ cls: "fjg-convert-list" });
    const preview = this.contentEl.createDiv();
    const render = () => {
      list.empty(); preview.empty();
      for (const task of tasks.filter((item) => item.record.task_id !== parentId && item.record.title.toLowerCase().includes(search.value.toLowerCase()))) {
        new Setting(list).setName(task.record.title).setDesc(task.taskFile.path).addToggle((toggle) => toggle.setValue(selected.has(task.record.task_id)).onChange((value) => {
          if (value) selected.add(task.record.task_id); else selected.delete(task.record.task_id);
          renderPreview();
          renderParents();
        }));
      }
      renderPreview();
    };
    const renderPreview = () => {
      preview.empty();
      preview.createEl("p", { text: `${selected.size} selected. Their notes, due dates, statuses and update histories will carry over. Owned attachment folders move into the parent objective's action attachment area. Original objectives are archived. Shared external references remain in those original records.` });
      for (const id of selected) {
        const task = tasks.find((item) => item.record.task_id === id);
        if (task) preview.createEl("p", { text: `${task.record.title} → ${tasks.find((item) => item.record.task_id === parentId)?.record.title || "Choose parent"}` });
      }
    };
    search.addEventListener("input", render);
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Convert reviewed objectives").setCta().onClick(async () => {
        if (!parentId || !selected.size) { new Notice("Choose a parent and at least one objective."); return; }
        if ([...selected].some((id) => this.service.getById(id).record.subtasks.length)) { new Notice("Selected objectives with existing actions cannot be nested again."); return; }
        button.setDisabled(true);
        let completed = 0;
        try {
          for (const id of [...selected]) { await this.service.convertTaskToSubtask(id, parentId); selected.delete(id); completed++; }
          new Notice(`Converted ${completed} objectives to actions.`); this.close();
        } catch (error) { new Notice(`${completed} converted. Remaining objectives were not converted: ${String(error)}`, 12000); }
        finally { this.refreshed(); button.setDisabled(false); render(); }
      }));
    renderParents();
    render();
  }
}

export class PromoteSubtaskModal extends Modal {
  constructor(app: App, private title: string, private promote: () => Promise<void>) { super(app); }
  onOpen(): void {
    this.setTitle(`Promote ${this.title}`);
    this.contentEl.createEl("p", { text: "Create a full objective with this action's status, due date, notes and preserved history. Its attachment folder will move into the new objective's Files folder, and the action will leave the parent card." });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Promote to objective").setCta().onClick(async () => {
        b.setDisabled(true);
        try { await this.promote(); this.close(); } catch (error) { new Notice(String(error)); } finally { b.setDisabled(false); }
      }));
  }
}
