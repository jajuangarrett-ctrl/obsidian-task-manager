import { createCreatePayload, createUpdatePayload, encodeProtocolPayload, CatalogTask } from "@fjg/task-protocol";
import { statusLabel, TASK_STATUSES, TaskStatus } from "@fjg/task-core";
import { fetchProjects, searchCatalog } from "./catalog-client";
import { firstMeaningfulLine, sourceForPage, splitSelectedLines } from "./capture";
import { responseOutputText } from "./openai-response";
import {
  ClipperSettings,
  loadRecentTasks,
  loadSettings,
  PENDING_CONTEXT_KEY,
  PendingContext,
  rememberTask,
  saveSettings
} from "./storage";

const MAX_PROTOCOL_URL = 8_000;
const PENDING_MAX_AGE = 5 * 60 * 1000;
let settings: ClipperSettings;
let mode: "create" | "update" = "create";
let pageContext: PendingContext = {
  selection: "",
  title: "",
  url: "",
  sourceKind: "web",
  mode: "create",
  createdAt: Date.now()
};
let selectedTask: CatalogTask | null = null;
let searchAbort: AbortController | null = null;
let searchTimer: number | null = null;

const elements = {
  createTab: getButton("create-tab"),
  updateTab: getButton("update-tab"),
  createPanel: getElement("create-panel"),
  updatePanel: getElement("update-panel"),
  title: getInput("task-title"),
  generate: getButton("generate-title"),
  details: getTextArea("task-text"),
  split: getInput("split-lines"),
  status: getSelect("status"),
  project: getSelect("project"),
  tags: getInput("tags"),
  createSource: getInput("create-source"),
  preview: getElement("preview-body"),
  previewState: getElement("preview-state"),
  submit: getButton("submit"),
  taskQuery: getInput("task-query"),
  taskResults: getElement("task-results"),
  updateText: getTextArea("update-text"),
  updateSource: getInput("update-source"),
  notice: getElement("notice"),
  settings: getButton("open-settings")
};

void bootstrap();

async function bootstrap(): Promise<void> {
  settings = await loadSettings();
  pageContext = await loadInitialContext();
  mode = pageContext.mode;
  elements.details.value = pageContext.selection || pageContext.title;
  elements.title.value = firstMeaningfulLine(elements.details.value) || pageContext.title;
  elements.updateText.value = pageContext.selection;
  elements.tags.value = "task";
  renderStatusOptions();
  await renderProjects();
  bindEvents();
  setMode(mode);
  await showRecentTasks();
}

function bindEvents(): void {
  elements.createTab.addEventListener("click", () => setMode("create"));
  elements.updateTab.addEventListener("click", () => setMode("update"));
  elements.settings.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.submit.addEventListener("click", submit);
  elements.generate.addEventListener("click", generateTitle);
  elements.taskQuery.addEventListener("input", scheduleSearch);
  for (const element of [
    elements.title,
    elements.details,
    elements.split,
    elements.status,
    elements.project,
    elements.tags,
    elements.createSource,
    elements.updateText,
    elements.updateSource
  ]) {
    element.addEventListener("input", renderPreview);
    element.addEventListener("change", renderPreview);
  }
}

function setMode(value: "create" | "update"): void {
  mode = value;
  elements.createTab.classList.toggle("is-active", mode === "create");
  elements.updateTab.classList.toggle("is-active", mode === "update");
  elements.createPanel.hidden = mode !== "create";
  elements.updatePanel.hidden = mode !== "update";
  elements.submit.textContent = mode === "create" ? "Create Task" : "Add Update";
  renderPreview();
}

function renderStatusOptions(): void {
  elements.status.replaceChildren();
  for (const status of TASK_STATUSES.filter((item) => item !== "archived")) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = statusLabel(status);
    elements.status.append(option);
  }
  elements.status.value = settings.defaultStatus;
}

async function renderProjects(): Promise<void> {
  const liveProjects = await fetchProjects(settings).catch(() => []);
  const projects = [...new Set([...settings.projects, ...liveProjects])].sort((left, right) => left.localeCompare(right));
  elements.project.replaceChildren(new Option("No project", ""));
  for (const project of projects) elements.project.append(new Option(project, project));
}

function renderPreview(): void {
  if (mode === "create") {
    const items = createItems();
    elements.previewState.textContent = `${items.length} task${items.length === 1 ? "" : "s"}`;
    elements.preview.textContent = items.length
      ? items.map((item, index) => [
        `${index + 1}. ${item.title}`,
        `Status: ${statusLabel(item.status as TaskStatus)}`,
        item.project ? `Project: ${item.project}` : "Project: none",
        `Tags: ${item.tags.join(", ") || "none"}`,
        item.source.type !== "manual" ? `Source: ${item.source.title || item.source.url}` : "Source: omitted"
      ].join("\n")).join("\n\n")
      : "(no task text yet)";
    elements.submit.disabled = items.length === 0;
    return;
  }
  elements.previewState.textContent = selectedTask ? selectedTask.title : "Choose task";
  const source = sourceForPage(pageContext, elements.updateSource.checked);
  elements.preview.textContent = [
    `### ${formatNow()}`,
    selectedTask ? `Task: ${selectedTask.title} (${selectedTask.task_id})` : "Task: not selected",
    "",
    elements.updateText.value.trim() || "(no update text yet)",
    source.type === "email" ? `Email subject: ${source.title || "unavailable"}` :
      source.type === "web" ? `Source: ${source.title || source.url}` : "Source: omitted"
  ].join("\n");
  elements.submit.disabled = !elements.updateText.value.trim() || !resolvedTaskId();
}

function createItems(): Array<{
  title: string;
  details: string;
  status: TaskStatus;
  project: string;
  tags: string[];
  source: ReturnType<typeof sourceForPage>;
}> {
  const text = elements.details.value.trim();
  if (!text) return [];
  const status = elements.status.value as TaskStatus;
  const project = elements.project.value;
  const tags = normalizeTags(elements.tags.value);
  const source = sourceForPage(pageContext, elements.createSource.checked);
  if (elements.split.checked) {
    return splitSelectedLines(text).map((line) => ({ title: line, details: line, status, project, tags, source }));
  }
  return [{
    title: elements.title.value.trim() || firstMeaningfulLine(text),
    details: text,
    status,
    project,
    tags,
    source
  }];
}

async function submit(): Promise<void> {
  setNotice("");
  elements.submit.disabled = true;
  try {
    if (mode === "create") {
      const items = createItems();
      const payload = createCreatePayload(items);
      settings.defaultStatus = elements.status.value as TaskStatus;
      await saveSettings(settings);
      await sendToObsidian(payload);
      setNotice(`Sent ${items.length} task${items.length === 1 ? "" : "s"} to Obsidian. Verify the Obsidian notice.`);
    } else {
      const taskId = resolvedTaskId();
      if (!taskId) throw new Error("Select a task from search results or enter a stable task ID.");
      const payload = createUpdatePayload({
        taskId,
        taskQuery: elements.taskQuery.value,
        updateText: elements.updateText.value,
        source: sourceForPage(pageContext, elements.updateSource.checked)
      });
      if (selectedTask) await rememberTask(selectedTask);
      await sendToObsidian(payload);
      setNotice("Update sent to Obsidian. Verify the Obsidian notice.");
    }
  } catch (error) {
    setNotice(error instanceof Error ? error.message : String(error), true);
  } finally {
    renderPreview();
  }
}

async function sendToObsidian(payload: ReturnType<typeof createCreatePayload> | ReturnType<typeof createUpdatePayload>): Promise<void> {
  const encoded = encodeProtocolPayload(payload);
  const url = `obsidian://fjg-task-clipper?payload=${encodeURIComponent(encoded)}`;
  if (url.length > MAX_PROTOCOL_URL) {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    throw new Error("This clip is too large for a safe Obsidian link. The payload was copied; use Import Task Clipper Payload from Clipboard.");
  }
  await chrome.tabs.create({ url });
}

function scheduleSearch(): void {
  selectedTask = null;
  if (searchTimer !== null) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(runSearch, 220);
  renderPreview();
}

async function runSearch(): Promise<void> {
  const query = elements.taskQuery.value.trim();
  searchAbort?.abort();
  searchAbort = new AbortController();
  try {
    const tasks = query ? await searchCatalog(settings, query, searchAbort.signal) : await loadRecentTasks();
    renderTaskResults(tasks, query ? "No matching tasks." : "No recent tasks.");
  } catch (error) {
    const recent = await loadRecentTasks();
    renderTaskResults(recent, "Task catalog unavailable. Enter a stable task ID or use a recent task.");
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      setNotice(error instanceof Error ? error.message : String(error), true);
    }
  }
}

async function showRecentTasks(): Promise<void> {
  renderTaskResults(await loadRecentTasks(), "Type to search your Obsidian tasks.");
}

function renderTaskResults(tasks: CatalogTask[], emptyText: string): void {
  elements.taskResults.replaceChildren();
  if (!tasks.length) {
    const empty = document.createElement("p");
    empty.className = "task-result-empty";
    empty.textContent = emptyText;
    elements.taskResults.append(empty);
    return;
  }
  for (const task of tasks) {
    const button = document.createElement("button");
    button.className = "task-result";
    button.type = "button";
    const title = document.createElement("strong");
    title.textContent = task.title;
    const meta = document.createElement("span");
    meta.textContent = [statusLabel(task.status), task.project, task.delegated_to, task.task_id].filter(Boolean).join(" • ");
    button.append(title, meta);
    button.addEventListener("click", () => {
      selectedTask = task;
      elements.taskQuery.value = task.title;
      for (const item of Array.from(elements.taskResults.querySelectorAll(".task-result"))) item.classList.remove("is-selected");
      button.classList.add("is-selected");
      renderPreview();
    });
    elements.taskResults.append(button);
  }
}

async function generateTitle(): Promise<void> {
  const text = elements.details.value.trim();
  if (!text) return setNotice("Add task text first.", true);
  if (!settings.openAiApiKey) return setNotice("Add an OpenAI API key in Settings to use Generate.", true);
  elements.generate.disabled = true;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.openAiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: settings.openAiModel,
        input: `Write one concise action-oriented task title, no quotes, maximum 12 words.\n\n${text}`
      })
    });
    const body = await response.json() as { output_text?: string; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message || `OpenAI HTTP ${response.status}`);
    const title = responseOutputText(body).replace(/^["']|["']$/g, "");
    if (!title) throw new Error("No title was returned.");
    elements.title.value = title;
    renderPreview();
  } catch (error) {
    setNotice(error instanceof Error ? error.message : String(error), true);
  } finally {
    elements.generate.disabled = false;
  }
}

async function loadInitialContext(): Promise<PendingContext> {
  const stored = await chrome.storage.local.get(PENDING_CONTEXT_KEY);
  const pending = stored[PENDING_CONTEXT_KEY] as PendingContext | undefined;
  if (pending && Date.now() - pending.createdAt <= PENDING_MAX_AGE) {
    await chrome.storage.local.remove(PENDING_CONTEXT_KEY);
    return pending;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return pageContext;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        selection: window.getSelection()?.toString() || "",
        title: document.title || "",
        url: location.href,
        sourceKind: /(?:outlook|office|mail\.google)/i.test(location.hostname) ? "email" as const : "web" as const
      })
    });
    return { ...(result.result || pageContext), mode: "create", createdAt: Date.now() };
  } catch {
    return { ...pageContext, title: tab.title || "", url: tab.url || "", createdAt: Date.now() };
  }
}

function resolvedTaskId(): string {
  if (selectedTask) return selectedTask.task_id;
  const query = elements.taskQuery.value.trim();
  return /^(?:tsk_[a-z0-9]+|FJG-[A-Z0-9]+)$/i.test(query) ? query : "";
}

function normalizeTags(value: string): string[] {
  const tags = value.split(/[,\s]+/).map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean);
  const withoutStatuses = tags.filter((tag) => !TASK_STATUSES.some((status) => status.replace(/-/g, "") === tag.toLowerCase().replace(/-/g, "")));
  return withoutStatuses.some((tag) => tag.toLowerCase() === "task")
    ? ["task", ...withoutStatuses.filter((tag) => tag.toLowerCase() !== "task")]
    : ["task", ...withoutStatuses];
}

function formatNow(): string {
  return new Date().toLocaleString("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function setNotice(message: string, error = false): void {
  elements.notice.textContent = message;
  elements.notice.classList.toggle("is-error", error);
  elements.notice.hidden = !message;
}

function getElement(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value;
}
function getButton(id: string): HTMLButtonElement { return getElement(id) as HTMLButtonElement; }
function getInput(id: string): HTMLInputElement { return getElement(id) as HTMLInputElement; }
function getTextArea(id: string): HTMLTextAreaElement { return getElement(id) as HTMLTextAreaElement; }
function getSelect(id: string): HTMLSelectElement { return getElement(id) as HTMLSelectElement; }
