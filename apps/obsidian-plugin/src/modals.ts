import { App, Modal, Setting } from "obsidian";
import { statusLabel, TASK_STATUSES, TaskStatus } from "@fjg/task-core";

export interface CreateTaskFormValue {
  title: string;
  details: string;
  status: TaskStatus;
  project: string;
  due: string;
  delegatedTo: string;
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

  constructor(app: App, private readonly submit: (value: CreateTaskFormValue) => Promise<void>) {
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
    new Setting(this.contentEl).setName("Project").addText((text) => text.onChange((value) => this.value.project = value));
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
