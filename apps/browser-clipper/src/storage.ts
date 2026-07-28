import { TaskStatus } from "@fjg/task-core";
import type { CatalogTask } from "@fjg/task-protocol";

export interface ClipperSettings {
  catalogPort: number;
  catalogToken: string;
  projects: string[];
  defaultStatus: TaskStatus;
  openAiModel: string;
  openAiApiKey: string;
}

export interface PendingContext {
  selection: string;
  title: string;
  url: string;
  sourceKind: "web" | "email";
  mode: "create" | "update";
  createdAt: number;
}

const SETTINGS_KEY = "fjgTaskManagerClipperSettings";
export const PENDING_CONTEXT_KEY = "fjgTaskManagerPendingContext";
const RECENT_TASKS_KEY = "fjgTaskManagerRecentTasks";

export const DEFAULT_CLIPPER_SETTINGS: ClipperSettings = {
  catalogPort: 27124,
  catalogToken: "",
  projects: [],
  defaultStatus: "inbox",
  openAiModel: "gpt-4.1-mini",
  openAiApiKey: ""
};

export async function loadSettings(): Promise<ClipperSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const value = stored[SETTINGS_KEY] as Partial<ClipperSettings> | undefined;
  return {
    ...DEFAULT_CLIPPER_SETTINGS,
    ...(value || {}),
    catalogPort: normalizePort(value?.catalogPort),
    projects: normalizeProjects(value?.projects),
    catalogToken: String(value?.catalogToken || ""),
    openAiApiKey: String(value?.openAiApiKey || "")
  };
}

export async function saveSettings(settings: ClipperSettings): Promise<void> {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      ...settings,
      catalogPort: normalizePort(settings.catalogPort),
      projects: normalizeProjects(settings.projects)
    }
  });
}

export async function loadRecentTasks(): Promise<CatalogTask[]> {
  const stored = await chrome.storage.local.get(RECENT_TASKS_KEY);
  return Array.isArray(stored[RECENT_TASKS_KEY]) ? stored[RECENT_TASKS_KEY].slice(0, 12) : [];
}

export async function rememberTask(task: CatalogTask): Promise<void> {
  const current = await loadRecentTasks();
  const next = [task, ...current.filter((item) => item.task_id !== task.task_id)].slice(0, 12);
  await chrome.storage.local.set({ [RECENT_TASKS_KEY]: next });
}

function normalizePort(value: unknown): number {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_CLIPPER_SETTINGS.catalogPort;
}

function normalizeProjects(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}
