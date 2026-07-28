import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { createRequestId, DEFAULT_ACTIVE_ROOT, DEFAULT_ARCHIVE_ROOT, normalizeVaultPath } from "@fjg/task-core";
import type FjgTaskManagerPlugin from "../main";

export interface TaskManagerSettings {
  activeRoot: string;
  archiveRoot: string;
  dashboardDefault: "do-first";
  catalogEnabled: boolean;
  catalogPort: number;
  catalogToken: string;
  processedRequestIds: string[];
}

export const DEFAULT_SETTINGS: TaskManagerSettings = {
  activeRoot: DEFAULT_ACTIVE_ROOT,
  archiveRoot: DEFAULT_ARCHIVE_ROOT,
  dashboardDefault: "do-first",
  catalogEnabled: true,
  catalogPort: 27124,
  catalogToken: "",
  processedRequestIds: []
};

export function normalizeSettings(value: Partial<TaskManagerSettings>): TaskManagerSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    activeRoot: normalizeVaultPath(value.activeRoot || DEFAULT_ACTIVE_ROOT),
    archiveRoot: normalizeVaultPath(value.archiveRoot || DEFAULT_ARCHIVE_ROOT),
    dashboardDefault: "do-first",
    catalogEnabled: value.catalogEnabled !== false,
    catalogPort: normalizePort(value.catalogPort),
    catalogToken: value.catalogToken || createCatalogToken(),
    processedRequestIds: Array.isArray(value.processedRequestIds) ? value.processedRequestIds.slice(-500) : []
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
  }
}

function normalizePort(value: unknown): number {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_SETTINGS.catalogPort;
}
