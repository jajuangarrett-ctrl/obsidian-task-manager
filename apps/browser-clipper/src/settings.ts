import { testCatalog } from "./catalog-client";
import { loadSettings, saveSettings } from "./storage";

const port = getInput("catalog-port");
const token = getInput("catalog-token");
const projects = getTextArea("projects");
const model = getInput("openai-model");
const apiKey = getInput("openai-key");
const notice = getElement("settings-notice");

void initialize();

async function initialize(): Promise<void> {
  const settings = await loadSettings();
  port.value = String(settings.catalogPort);
  token.value = settings.catalogToken;
  projects.value = settings.projects.join("\n");
  model.value = settings.openAiModel;
  apiKey.value = settings.openAiApiKey;

  getButton("save-settings").addEventListener("click", async () => {
    settings.catalogPort = Number(port.value);
    settings.catalogToken = token.value.trim();
    settings.projects = projects.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    settings.openAiModel = model.value.trim() || "gpt-4.1-mini";
    settings.openAiApiKey = apiKey.value.trim();
    await saveSettings(settings);
    show("Settings saved.");
  });

  getButton("test-catalog").addEventListener("click", async () => {
    try {
      await testCatalog({
        catalogPort: Number(port.value),
        catalogToken: token.value.trim()
      });
      show("Connected to the FJG Task Manager catalog.");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), true);
    }
  });
}

function show(message: string, error = false): void {
  notice.textContent = message;
  notice.classList.toggle("is-error", error);
}
function getElement(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value;
}
function getButton(id: string): HTMLButtonElement { return getElement(id) as HTMLButtonElement; }
function getInput(id: string): HTMLInputElement { return getElement(id) as HTMLInputElement; }
function getTextArea(id: string): HTMLTextAreaElement { return getElement(id) as HTMLTextAreaElement; }
