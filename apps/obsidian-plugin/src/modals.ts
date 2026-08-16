import { App, Modal, Notice, setIcon, Setting, TFile } from "obsidian";
import { statusLabel, TASK_STATUSES, TaskStatus } from "@fjg/task-core";
import type { CatalogTask } from "@fjg/task-protocol";
import {
  filterProjectPickerOptions,
  normalizeProjectPickerText,
  projectPickerCreationError
} from "./project-picker-model";
import { filterTaskUpdateOptions } from "./task-update-capture-model";

export interface CreateTaskFormValue {
  title: string;
  details: string;
  status: TaskStatus;
  project: string;
  due: string;
  delegatedTo: string;
}

export interface CreateProjectFormValue {
  name: string;
  description: string;
}

export interface DashboardProjectPickerOption {
  key: string;
  name: string;
}

/** Search-only picker for dashboard scope; it deliberately cannot create projects. */
export class DashboardProjectPickerModal extends Modal {
  private query = "";

  constructor(
    app: App,
    private readonly currentProject: string,
    private readonly options: readonly DashboardProjectPickerOption[],
    private readonly selectProject: (projectKey: string) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("fjg-task-project-picker-modal");
    this.setTitle("Filter tasks by project");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: "Search projects to scope the current task view. Your current view and task search stay in place.",
      cls: "fjg-project-picker-intro"
    });
    const search = this.contentEl.createEl("input", {
      type: "search",
      cls: "fjg-project-picker-search",
      attr: { placeholder: "Search projects", "aria-label": "Search dashboard projects" }
    });
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.render();
    });
    const choices = this.contentEl.createDiv({ cls: "fjg-project-picker-choices", attr: { role: "listbox", "aria-label": "Projects" } });
    const matches = this.options.filter((option) => normalizeProjectPickerText(option.name).includes(normalizeProjectPickerText(this.query)));
    if (!matches.length) {
      choices.createDiv({ cls: "fjg-project-picker-empty", text: "No projects match this search." });
    } else {
      for (const option of matches) {
        const selected = option.key === this.currentProject;
        const button = choices.createEl("button", {
          cls: `fjg-project-picker-option${selected ? " is-selected" : ""}`,
          text: option.name,
          attr: { type: "button", role: "option", "aria-selected": String(selected) }
        });
        button.addEventListener("click", () => {
          this.selectProject(option.key);
          this.close();
        });
      }
    }
    window.setTimeout(() => search.focus(), 0);
  }
}

export class TaskProjectPickerModal extends Modal {
  private query = "";
  private error = "";

  constructor(
    app: App,
    private readonly taskTitle: string,
    private readonly currentProject: string,
    private readonly projectNames: () => string[],
    private readonly assignProject: (projectName: string) => Promise<void>,
    private readonly createAndAssignProject: (projectName: string) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("fjg-task-project-picker-modal");
    this.setTitle(`Project: ${this.taskTitle}`);
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: "Search an existing project, choose No project, or explicitly create and assign a new one.",
      cls: "fjg-project-picker-intro"
    });
    const search = this.contentEl.createEl("input", {
      type: "search",
      cls: "fjg-project-picker-search",
      attr: { placeholder: "Search projects", "aria-label": "Search projects" }
    });
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.error = "";
      this.render();
    });
    if (this.error) this.contentEl.createDiv({ cls: "fjg-project-picker-error", text: this.error });

    const choices = this.contentEl.createDiv({ cls: "fjg-project-picker-choices" });
    this.projectButton(choices, "No project", "", !this.currentProject);
    const options = filterProjectPickerOptions(this.projectNames(), this.query);
    if (!options.length) {
      choices.createDiv({ cls: "fjg-project-picker-empty", text: "No existing projects match this search." });
    } else {
      for (const project of options) this.projectButton(choices, project, project, project === this.currentProject);
    }

    const createName = this.query.replace(/\s+/g, " ").trim();
    if (createName) {
      const create = this.contentEl.createEl("button", {
        cls: "mod-cta fjg-project-picker-create",
        text: `Create project “${createName}” and assign`,
        attr: { type: "button" }
      });
      create.addEventListener("click", async () => {
        const validationError = projectPickerCreationError(this.projectNames(), createName);
        if (validationError) {
          this.error = validationError;
          this.render();
          return;
        }
        create.disabled = true;
        try {
          await this.createAndAssignProject(createName);
          this.close();
        } catch (error) {
          this.error = error instanceof Error ? error.message : String(error);
          this.render();
        }
      });
    }
    window.setTimeout(() => search.focus(), 0);
  }

  private projectButton(parent: HTMLElement, label: string, value: string, selected: boolean): void {
    const button = parent.createEl("button", {
      cls: `fjg-project-picker-option${selected ? " is-selected" : ""}`,
      text: label,
      attr: { type: "button", "aria-pressed": String(selected) }
    });
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await this.assignProject(value);
        this.close();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        this.render();
      }
    });
  }
}

export class ArchiveProjectModal extends Modal {
  constructor(
    app: App,
    private readonly projectName: string,
    private readonly completedTaskCount: number,
    private readonly submit: () => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(`Archive ${this.projectName}?`);
    this.contentEl.createEl("p", {
      text: "This removes the project from your active dashboard without deleting anything."
    });
    const list = this.contentEl.createEl("ul");
    list.createEl("li", {
      text: `Move the project folder to Project Archive.`
    });
    list.createEl("li", {
      text: `Move ${this.completedTaskCount} completed ${this.completedTaskCount === 1 ? "task" : "tasks"} to the task Archive.`
    });
    list.createEl("li", {
      text: "Keep every task update, related file, attachment, and project note."
    });
    this.contentEl.createEl("p", {
      text: "You can reopen the project later from Archived Projects. Its tasks stay archived until you reopen them individually.",
      cls: "setting-item-description"
    });
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText("Cancel")
        .onClick(() => this.close()))
      .addButton((button) => button
        .setButtonText("Archive Project")
        .setWarning()
        .onClick(async () => {
          button.setDisabled(true);
          try {
            await this.submit();
            this.close();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error), 8000);
          } finally {
            button.setDisabled(false);
          }
        }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class CreateProjectModal extends Modal {
  private value: CreateProjectFormValue = {
    name: "",
    description: ""
  };

  constructor(app: App, private readonly submit: (value: CreateProjectFormValue) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Create Project");
    new Setting(this.contentEl)
      .setName("Project name")
      .setDesc("This name will appear in the dashboard, Quick Capture, and Chrome clipper.")
      .addText((text) => {
        text.setPlaceholder("Project name");
        text.onChange((value) => this.value.name = value);
        window.setTimeout(() => text.inputEl.focus(), 0);
      });
    new Setting(this.contentEl)
      .setName("Description")
      .setDesc("Optional starting context for the project workspace.")
      .addTextArea((area) => {
        area.inputEl.rows = 5;
        area.onChange((value) => this.value.description = value);
      });
    new Setting(this.contentEl).addButton((button) => button
      .setButtonText("Create Project")
      .setCta()
      .onClick(async () => {
        if (!this.value.name.trim()) {
          new Notice("Enter a project name.");
          return;
        }
        button.setDisabled(true);
        try {
          await this.submit(this.value);
          this.close();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error), 8000);
        } finally {
          button.setDisabled(false);
        }
      }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class CreateTaskModal extends Modal {
  private value: CreateTaskFormValue = {
    title: "",
    details: "",
    status: "inbox",
    project: "",
    due: "",
    delegatedTo: ""
  };

  constructor(
    app: App,
    private readonly projectNames: string[],
    private readonly submit: (value: CreateTaskFormValue) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Create Task Workspace");
    new Setting(this.contentEl).setName("Title").addText((text) => text.onChange((value) => this.value.title = value));
    new Setting(this.contentEl).setName("Details").addTextArea((area) => {
      area.inputEl.rows = 6;
      area.onChange((value) => this.value.details = value);
    });
    new Setting(this.contentEl).setName("Status").addDropdown((dropdown) => {
      for (const status of TASK_STATUSES.filter((item) => item !== "archived" && item !== "completed")) {
        dropdown.addOption(status, statusLabel(status));
      }
      dropdown.onChange((value) => this.value.status = value as TaskStatus);
    });
    new Setting(this.contentEl).setName("Project").addDropdown((dropdown) => {
      dropdown.addOption("", "No Project");
      for (const projectName of this.projectNames) {
        dropdown.addOption(projectName, projectName);
      }
      dropdown.onChange((value) => this.value.project = value);
    });
    new Setting(this.contentEl).setName("Due date").setDesc("YYYY-MM-DD").addText((text) => text.onChange((value) => this.value.due = value));
    new Setting(this.contentEl).setName("Delegated to").addText((text) => text.onChange((value) => this.value.delegatedTo = value));
    new Setting(this.contentEl).addButton((button) => button
      .setButtonText("Create Task")
      .setCta()
      .onClick(async () => {
        button.setDisabled(true);
        try {
          await this.submit(this.value);
          this.close();
        } finally {
          button.setDisabled(false);
        }
      }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class TextEntryModal extends Modal {
  private text = "";

  constructor(
    app: App,
    private readonly titleText: string,
    private readonly buttonText: string,
    private readonly submit: (text: string) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.titleText);
    new Setting(this.contentEl).setName("Update").addTextArea((area) => {
      area.inputEl.rows = 8;
      area.onChange((value) => this.text = value);
    });
    new Setting(this.contentEl).addButton((button) => button
      .setButtonText(this.buttonText)
      .setCta()
      .onClick(async () => {
        if (!this.text.trim()) return;
        button.setDisabled(true);
        try {
          await this.submit(this.text.trim());
          this.close();
        } finally {
          button.setDisabled(false);
        }
      }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class TaskUpdateCaptureModal extends Modal {
  private query = "";
  private text: string;
  private selectedTaskId = "";
  private resultsEl!: HTMLElement;
  private submitEl!: HTMLButtonElement;

  constructor(
    app: App,
    private readonly tasks: readonly CatalogTask[],
    initialText: string,
    private readonly submit: (taskId: string, text: string) => Promise<void>
  ) {
    super(app);
    this.text = initialText;
  }

  onOpen(): void {
    this.modalEl.addClass("fjg-task-update-capture-modal");
    this.setTitle("Add Update to Existing Task");
    this.contentEl.createEl("p", {
      text: "Choose one exact task, review the prefilled email update, then confirm. Opening this form does not change any task.",
      cls: "fjg-task-update-capture-intro"
    });

    const search = this.contentEl.createEl("input", {
      type: "search",
      cls: "fjg-task-update-capture-search",
      attr: { placeholder: "Search task title, project, person, or ID", "aria-label": "Search existing tasks" }
    });
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderResults();
    });

    this.resultsEl = this.contentEl.createDiv({
      cls: "fjg-task-update-capture-results",
      attr: { role: "listbox", "aria-label": "Matching tasks" }
    });
    this.renderResults();

    new Setting(this.contentEl).setName("Update").setDesc("Review or edit before saving.").addTextArea((area) => {
      area.inputEl.rows = 8;
      area.inputEl.value = this.text;
      area.onChange((value) => {
        this.text = value;
        this.syncSubmitState();
      });
    });
    new Setting(this.contentEl).addButton((button) => {
      button.setButtonText("Add Update").setCta().setDisabled(true).onClick(async () => {
        const text = this.text.trim();
        if (!this.selectedTaskId || !text) return;
        button.setDisabled(true);
        try {
          await this.submit(this.selectedTaskId, text);
          this.close();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error), 8000);
          this.syncSubmitState();
        }
      });
      this.submitEl = button.buttonEl;
    });
    window.setTimeout(() => search.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderResults(): void {
    this.resultsEl.empty();
    const matches = filterTaskUpdateOptions(this.tasks, this.query, 20);
    if (!matches.length) {
      this.resultsEl.createDiv({ cls: "fjg-task-update-capture-empty", text: "No tasks match this search." });
      return;
    }
    for (const task of matches) {
      const selected = task.task_id === this.selectedTaskId;
      const button = this.resultsEl.createEl("button", {
        cls: `fjg-task-update-capture-option${selected ? " is-selected" : ""}`,
        attr: {
          type: "button",
          role: "option",
          "aria-selected": String(selected),
          title: `Task ID: ${task.task_id}`
        }
      });
      button.createEl("strong", { text: task.title });
      const metadata = [statusLabel(task.status), task.project, task.delegated_to, task.archived ? "Archived" : ""]
        .filter(Boolean)
        .join(" · ");
      button.createEl("span", { text: metadata || task.task_id });
      button.addEventListener("click", () => {
        this.selectedTaskId = task.task_id;
        this.renderResults();
        this.syncSubmitState();
      });
    }
  }

  private syncSubmitState(): void {
    if (this.submitEl) this.submitEl.disabled = !this.selectedTaskId || !this.text.trim();
  }
}

export class TaskFileModal extends Modal {
  private mode: "note" | "attachment" = "note";
  private noteTitle = "";
  private noteBody = "";
  private attachments: File[] = [];

  constructor(
    app: App,
    private readonly taskTitle: string,
    private readonly createNote: (title: string, body: string) => Promise<void>,
    private readonly attachFiles: (files: File[]) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("fjg-task-file-modal-shell");
    this.setTitle(`Add file to ${this.taskTitle}`);
    const intro = this.contentEl.createEl("p", {
      text: "Create a working note or attach an existing document. It will stay inside this task workspace.",
      cls: "fjg-task-file-intro"
    });
    intro.setAttr("data-mode", this.mode);
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.querySelectorAll(".fjg-task-file-content").forEach((element) => element.remove());
    const shell = this.contentEl.createDiv({ cls: "fjg-task-file-content" });
    const tabs = shell.createDiv({
      cls: "fjg-task-file-tabs",
      attr: { role: "tablist", "aria-label": "File type" }
    });
    this.createTab(tabs, "note", "New note");
    this.createTab(tabs, "attachment", "Attach files");
    if (this.mode === "note") this.renderNoteForm(shell);
    else this.renderAttachmentForm(shell);
  }

  private createTab(parent: HTMLElement, mode: "note" | "attachment", label: string): void {
    const button = parent.createEl("button", {
      text: label,
      cls: this.mode === mode ? "is-active" : "",
      attr: {
        type: "button",
        role: "tab",
        "aria-selected": String(this.mode === mode)
      }
    });
    button.addEventListener("click", () => {
      this.mode = mode;
      this.render();
    });
  }

  private renderNoteForm(parent: HTMLElement): void {
    const panel = parent.createDiv({ cls: "fjg-task-file-panel" });
    const titleLabel = panel.createEl("label", { text: "Note title" });
    const title = panel.createEl("input", {
      type: "text",
      placeholder: "Meeting notes, draft, research…",
      attr: { "aria-label": "Related note title" }
    });
    title.id = "fjg-task-related-note-title";
    title.value = this.noteTitle;
    title.addEventListener("input", () => this.noteTitle = title.value);
    const bodyLabel = panel.createEl("label", { text: "Starting notes (optional)" });
    const body = panel.createEl("textarea", {
      placeholder: "Add context now, or leave this blank and write in the new note.",
      attr: { "aria-label": "Starting note content", rows: "7" }
    });
    body.id = "fjg-task-related-note-body";
    body.value = this.noteBody;
    body.addEventListener("input", () => this.noteBody = body.value);
    const submit = panel.createEl("button", { text: "Create and open note", cls: "mod-cta" });
    submit.addEventListener("click", async () => {
      if (!this.noteTitle.trim()) {
        title.focus();
        return;
      }
      submit.disabled = true;
      try {
        await this.createNote(this.noteTitle.trim(), this.noteBody.trim());
        this.close();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error), 8000);
      } finally {
        submit.disabled = false;
      }
    });
    window.setTimeout(() => title.focus(), 0);
    titleLabel.htmlFor = title.id;
    bodyLabel.htmlFor = body.id;
  }

  private renderAttachmentForm(parent: HTMLElement): void {
    const panel = parent.createDiv({ cls: "fjg-task-file-panel" });
    const drop = panel.createEl("label", { cls: "fjg-task-file-picker" });
    drop.createEl("span", { text: "Choose one or more files", cls: "fjg-task-file-picker-title" });
    drop.createEl("span", {
      text: "Documents, PDFs, images, spreadsheets, and other supporting files are accepted.",
      cls: "fjg-task-file-picker-copy"
    });
    const input = drop.createEl("input", {
      type: "file",
      attr: { multiple: "true", "aria-label": "Choose related files" }
    });
    input.addEventListener("change", () => {
      this.attachments = Array.from(input.files || []);
      this.renderAttachmentSelection(panel, submit);
    });
    const selection = panel.createDiv({ cls: "fjg-task-file-selection" });
    if (this.attachments.length) {
      selection.setText(fileSelectionLabel(this.attachments));
    }
    const submit = panel.createEl("button", {
      text: "Add to task",
      cls: "mod-cta"
    });
    submit.disabled = !this.attachments.length;
    submit.addEventListener("click", async () => {
      if (!this.attachments.length) return;
      submit.disabled = true;
      try {
        await this.attachFiles(this.attachments);
        this.close();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error), 8000);
      } finally {
        submit.disabled = false;
      }
    });
  }

  private renderAttachmentSelection(panel: HTMLElement, submit: HTMLButtonElement): void {
    const selection = panel.querySelector<HTMLElement>(".fjg-task-file-selection");
    if (selection) selection.setText(fileSelectionLabel(this.attachments));
    submit.disabled = !this.attachments.length;
  }
}

function fileSelectionLabel(files: File[]): string {
  if (files.length === 1) return files[0].name;
  return files.length ? `${files.length} files selected` : "";
}

export interface TaskFolderEntry {
  file: TFile;
  description: string;
  icon: string;
}

export class TaskFolderModal extends Modal {
  constructor(
    app: App,
    private readonly taskTitle: string,
    private readonly folderPath: string,
    private readonly entries: TaskFolderEntry[],
    private readonly openFile: (file: TFile) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("fjg-task-folder-modal-shell");
    this.setTitle(this.taskTitle);
    this.contentEl.createEl("p", {
      text: "Task attachments folder",
      cls: "fjg-task-folder-eyebrow"
    });
    this.contentEl.createEl("code", {
      text: this.folderPath,
      cls: "fjg-task-folder-path"
    });
    const list = this.contentEl.createDiv({ cls: "fjg-task-folder-list" });
    for (const entry of this.entries) {
      const button = list.createEl("button", {
        cls: "fjg-task-folder-entry",
        attr: {
          type: "button",
          "aria-label": `Open ${entry.file.name}`
        }
      });
      const icon = button.createSpan({ cls: "fjg-task-folder-entry-icon" });
      setIcon(icon, entry.icon);
      const copy = button.createSpan({ cls: "fjg-task-folder-entry-copy" });
      copy.createSpan({ text: entry.file.name, cls: "fjg-task-folder-entry-name" });
      copy.createSpan({ text: entry.description, cls: "fjg-task-folder-entry-description" });
      const chevron = button.createSpan({ cls: "fjg-task-folder-entry-chevron" });
      setIcon(chevron, "chevron-right");
      button.addEventListener("click", async () => {
        await this.openFile(entry.file);
        this.close();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
