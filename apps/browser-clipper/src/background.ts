import { PENDING_CONTEXT_KEY, PendingContext } from "./storage";

chrome.runtime.onInstalled.addListener(() => setupMenus());
chrome.runtime.onStartup.addListener(() => setupMenus());

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!["fjg-create-selection", "fjg-update-selection", "fjg-create-page"].includes(String(info.menuItemId))) return;
  const page = await readPageContext(tab);
  const context: PendingContext = {
    selection: info.selectionText || "",
    title: page.title,
    url: page.url,
    sourceKind: page.sourceKind,
    mode: info.menuItemId === "fjg-update-selection" ? "update" : "create",
    createdAt: Date.now()
  };
  await chrome.storage.local.set({ [PENDING_CONTEXT_KEY]: context });
  try {
    await chrome.action.openPopup();
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
  }
});

async function setupMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: "fjg-create-selection", title: "Create Obsidian task from selection", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "fjg-update-selection", title: "Add selection as task update", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "fjg-create-page", title: "Create Obsidian task from page", contexts: ["page"] });
}

async function readPageContext(tab: chrome.tabs.Tab | undefined): Promise<{
  title: string;
  url: string;
  sourceKind: "web" | "email";
}> {
  if (!tab?.id) return { title: tab?.title || "", url: tab?.url || "", sourceKind: isEmailUrl(tab?.url || "") ? "email" : "web" };
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const url = location.href;
        const email = /(?:outlook|office|mail\.google)/i.test(location.hostname);
        const subject = email
          ? Array.from(document.querySelectorAll('[data-testid*="subject"], [aria-label^="Subject"], [role="heading"], h1, h2'))
            .map((node) => (node.textContent || "").trim())
            .find((text) => text.length >= 3 && text.length <= 240)
          : "";
        return {
          title: subject || document.title || "",
          url,
          sourceKind: email ? "email" as const : "web" as const
        };
      }
    });
    return result.result || { title: tab.title || "", url: tab.url || "", sourceKind: "web" };
  } catch {
    return { title: tab.title || "", url: tab.url || "", sourceKind: isEmailUrl(tab.url || "") ? "email" : "web" };
  }
}

function isEmailUrl(value: string): boolean {
  return /(?:outlook|office|mail\.google)/i.test(value);
}
