import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { createRequestId, DEFAULT_ACTIVE_ROOT, DEFAULT_ARCHIVE_ROOT, normalizeVaultPath } from "@fjg/task-core";
import type FjgTaskManagerPlugin from "../main";
import { testOpenAiKey } from "./openai-capture";
import { DEFAULT_GMAIL_TASK_INTAKE_ROOT } from "./gmail-task-intake";

export const DEFAULT_PROJECT_ROOT = "08 Tasks/Projects";
export const DEFAULT_PROJECT_ARCHIVE_ROOT = "08 Tasks/Project Archive";

export interface TaskManagerSettings {
  activeRoot: string;
  archiveRoot: string;
  projectRoot: string;
  projectArchiveRoot: string;
  dashboardDefault: "do-first";
  catalogEnabled: boolean;
  catalogPort: number;
  catalogToken: string;
  processedRequestIds: string[];
  openAiApiKey: string;
  openAiModel: string;
  transcriptionModel: string;
  autoDraftAfterTranscription: boolean;
  gmailTaskIntakeEnabled: boolean;
  gmailTaskIntakeRoot: string;
}

export const DEFAULT_SETTINGS: TaskManagerSettings = {
  activeRoot: DEFAULT_ACTIVE_ROOT,
  archiveRoot: DEFAULT_ARCHIVE_ROOT,
  projectRoot: DEFAULT_PROJECT_ROOT,
  projectArchiveRoot: DEFAULT_PROJECT_ARCHIVE_ROOT,
  dashboardDefault: "do-first",
  catalogEnabled: true,
  catalogPort: 27124,
  catalogToken: "",
  processedRequestIds: [],
  openAiApiKey: "",
  openAiModel: "gpt-4.1-mini",
  transcriptionModel: "gpt-4o-mini-transcribe",
  autoDraftAfterTranscription: true,
  gmailTaskIntakeEnabled: true,
  gmailTaskIntakeRoot: DEFAULT_GMAIL_TASK_INTAKE_ROOT
};

export function normalizeSettings(value: Partial<TaskManagerSettings>): TaskManagerSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    activeRoot: normalizeVaultPath(value.activeRoot || DEFAULT_ACTIVE_ROOT),
    archiveRoot: normalizeVaultPath(value.archiveRoot || DEFAULT_ARCHIVE_ROOT),
    projectRoot: normalizeVaultPath(value.projectRoot || DEFAULT_PROJECT_ROOT),
    projectArchiveRoot: normalizeVaultPath(value.projectArchiveRoot || DEFAULT_PROJECT_ARCHIVE_ROOT),
    dashboardDefault: "do-first",
    catalogEnabled: value.catalogEnabled !== false,
    catalogPort: normalizePort(value.catalogPort),
    catalogToken: value.catalogToken || createCatalogToken(),
    processedRequestIds: Array.isArray(value.processedRequestIds) ? value.processedRequestIds.slice(-500) : [],
    openAiApiKey: String(value.openAiApiKey || "").trim(),
    openAiModel: String(value.openAiModel || DEFAULT_SETTINGS.openAiModel).trim() || DEFAULT_SETTINGS.openAiModel,
    transcriptionModel: String(value.transcriptionModel || DEFAULT_SETTINGS.transcriptionModel).trim() || DEFAULT_SETTINGS.transcriptionModel,
    autoDraftAfterTranscription: value.autoDraftAfterTranscription !== false,
    gmailTaskIntakeEnabled: value.gmailTaskIntakeEnabled !== false,
    gmailTaskIntakeRoot: normalizeVaultPath(value.gmailTaskIntakeRoot || DEFAULT_GMAIL_TASK_INTAKE_ROOT)
  };
}

export function createCatalogToken(): string {
  return createRequestId().replace(/^req_/, "cat_");
}

export class TaskManagerSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly taskPlugin: FjgTaskManagerPlugin) {
    super(app, taskPlugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "FJG Task Manager" });

    new Setting(containerEl)
      .setName("Active task workspace root")
      .setDesc("Vault-relative folder containing active task workspaces.")
      .addText((text) => text
        .setValue(this.taskPlugin.settings.activeRoot)
        .onChange(async (value) => {
          this.taskPlugin.settings.activeRoot = normalizeVaultPath(value || DEFAULT_ACTIVE_ROOT);
          await this.taskPlugin.saveSettings();
          await this.taskPlugin.workspaceService.refresh();
        }));

    new Setting(containerEl)
      .setName("Archive workspace root")
      .setDesc("Archived task folders move here and return to the active root when reopened.")
      .addText((text) => text
        .setValue(this.taskPlugin.settings.archiveRoot)
        .onChange(async (value) => {
          this.taskPlugin.settings.archiveRoot = normalizeVaultPath(value || DEFAULT_ARCHIVE_ROOT);
          await this.taskPlugin.saveSettings();
          await this.taskPlugin.workspaceService.refresh();
        }));

    new Setting(containerEl)
      .setName("Project workspace root")
      .setDesc("Vault-relative folder containing project definitions created from the dashboard.")
      .addText((text) => text
        .setValue(this.taskPlugin.settings.projectRoot)
        .onChange(async (value) => {
          this.taskPlugin.settings.projectRoot = normalizeVaultPath(value || DEFAULT_PROJECT_ROOT);
          await this.taskPlugin.saveSettings();
          await this.taskPlugin.workspaceService.refresh();
        }));

    new Setting(containerEl)
      .setName("Project archive root")
      .setDesc("Completed project folders move here and can be reopened from the dashboard.")
      .addText((text) => text
        .setValue(this.taskPlugin.settings.projectArchiveRoot)
        .onChange(async (value) => {
          this.taskPlugin.settings.projectArchiveRoot = normalizeVaultPath(value || DEFAULT_PROJECT_ARCHIVE_ROOT);
          await this.taskPlugin.saveSettings();
          await this.taskPlugin.workspaceService.refresh();
        }));

    new Setting(containerEl)
      .setName("Desktop task search")
      .setDesc("Expose an authenticated, read-only catalog on this Mac for the Chrome clipper.")
      .addToggle((toggle) => toggle
        .setValue(this.taskPlugin.settings.catalogEnabled)
        .onChange(async (value) => {
          this.taskPlugin.settings.catalogEnabled = value;
          await this.taskPlugin.saveSettings();
          await this.taskPlugin.restartCatalog();
        }));

    new Setting(containerEl)
      .setName("Catalog port")
      .setDesc("Loopback port used only for Chrome task search.")
      .addText((text) => text
        .setValue(String(this.taskPlugin.settings.catalogPort))
        .onChange(async (value) => {
          this.taskPlugin.settings.catalogPort = normalizePort(Number(value));
          await this.taskPlugin.saveSettings();
          await this.taskPlugin.restartCatalog();
        }));

    new Setting(containerEl)
      .setName("Chrome pairing token")
      .setDesc("Copy this token into the FJG Obsidian Task Clipper settings. Keep it private.")
      .addText((text) => {
        text.setValue(this.taskPlugin.settings.catalogToken);
        text.inputEl.type = "password";
        text.inputEl.readOnly = true;
      })
      .addButton((button) => button
        .setButtonText("Copy")
        .onClick(async () => {
          await navigator.clipboard.writeText(this.taskPlugin.settings.catalogToken);
          new Notice("Task catalog token copied.");
        }))
      .addButton((button) => button
        .setButtonText("Regenerate")
        .setWarning()
        .onClick(async () => {
          this.taskPlugin.settings.catalogToken = createCatalogToken();
          await this.taskPlugin.saveSettings();
          await this.taskPlugin.restartCatalog();
          this.display();
          new Notice("Task catalog token regenerated. Update Chrome settings.");
        }));

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "The task catalog is read-only. All task creation and updates still pass through Obsidian."
    });

    containerEl.createEl("h3", { text: "Gmail task intake" });

    new Setting(containerEl)
      .setName("Import status-prefixed Gmail captures")
      .setDesc("Create FJG Task Manager workspaces from marked Gmail captures after they synchronize into the vault.")
      .addToggle((toggle) => toggle
        .setValue(this.taskPlugin.settings.gmailTaskIntakeEnabled)
        .onChange(async (value) => {
          this.taskPlugin.settings.gmailTaskIntakeEnabled = value;
          await this.taskPlugin.saveSettings();
          if (value) await this.taskPlugin.processGmailTaskIntake();
        }));

    new Setting(containerEl)
      .setName("Gmail intake folder")
      .setDesc("Vault-relative folder where the FJG Task Manager Apps Script saves captured email notes.")
      .addText((text) => text
        .setValue(this.taskPlugin.settings.gmailTaskIntakeRoot)
        .onChange(async (value) => {
          this.taskPlugin.settings.gmailTaskIntakeRoot = normalizeVaultPath(value || DEFAULT_GMAIL_TASK_INTAKE_ROOT);
          await this.taskPlugin.saveSettings();
        }));

    containerEl.createEl("h3", { text: "Quick Capture AI" });

    let openAiKeyInput: HTMLInputElement | null = null;
    new Setting(containerEl)
      .setName("OpenAI API key")
      .setDesc(
        "Used for voice transcription and AI task drafting. FJG Task Manager "
        + "will reuse a key already saved by the older Task Capture plugin."
      )
      .addText((text) => {
        openAiKeyInput = text.inputEl;
        text.inputEl.type = "password";
        text
          .setPlaceholder("sk-...")
          .setValue(this.taskPlugin.settings.openAiApiKey)
          .onChange(async (value) => {
            this.taskPlugin.settings.openAiApiKey = value.trim();
            await this.taskPlugin.saveSettings();
          });
      })
      .addButton((button) => button
        .setButtonText("Save & Test")
        .onClick(async () => {
          button.setDisabled(true);
          try {
            const key = (openAiKeyInput?.value
              || this.taskPlugin.settings.openAiApiKey).trim();
            this.taskPlugin.settings.openAiApiKey = key;
            await this.taskPlugin.saveSettings();
            await testOpenAiKey(key);
            new Notice("OpenAI API key is saved and active on this device.");
          } catch (error) {
            new Notice(`OpenAI connection failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
          } finally {
            button.setDisabled(false);
          }
        }));

    new Setting(containerEl)
      .setName("Task drafting model")
      .setDesc("OpenAI model used to turn rough text or a transcript into reviewable task fields.")
      .addText((text) => text
        .setValue(this.taskPlugin.settings.openAiModel)
        .onChange(async (value) => {
          this.taskPlugin.settings.openAiModel = value.trim() || DEFAULT_SETTINGS.openAiModel;
          await this.taskPlugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Transcription model")
      .setDesc("OpenAI speech-to-text model used by Dictate.")
      .addText((text) => text
        .setValue(this.taskPlugin.settings.transcriptionModel)
        .onChange(async (value) => {
          this.taskPlugin.settings.transcriptionModel = value.trim() || DEFAULT_SETTINGS.transcriptionModel;
          await this.taskPlugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Draft after dictation")
      .setDesc("After transcription, automatically populate the title, status, project, due date, and optional delegation.")
      .addToggle((toggle) => toggle
        .setValue(this.taskPlugin.settings.autoDraftAfterTranscription)
        .onChange(async (value) => {
          this.taskPlugin.settings.autoDraftAfterTranscription = value;
          await this.taskPlugin.saveSettings();
        }));
  }
}

function normalizePort(value: unknown): number {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_SETTINGS.catalogPort;
}
