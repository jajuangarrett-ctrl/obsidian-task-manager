import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ isDesktopApp: false, isMobile: true, isIosApp: true }));
vi.mock("obsidian", () => ({
  Platform: platform, Notice: vi.fn(), Plugin: class {}, Modal: class {},
  ItemView: class {}, PluginSettingTab: class {}, Setting: class {},
  FuzzySuggestModal: class {}, SuggestModal: class {}, TFile: class {}, TFolder: class {},
  Menu: class {}, MarkdownRenderer: class {}, setIcon: vi.fn(), normalizePath: (path: string) => path,
  requestUrl: vi.fn()
}));

import FjgTaskManagerPlugin from "../main.ts";
import { UnifiedCaptureModal } from "./unified-capture-modal";
import { SYSTEM_CAPTURE_CLIPBOARD_PREFIX } from "./system-capture-clipboard";

function harness(desktop: boolean, hasElectron = true) {
  Object.assign(platform, {isDesktopApp:desktop, isMobile:!desktop, isIosApp:!desktop});
  const native = {readText:vi.fn(() => "ordinary copied text"), writeText:vi.fn()};
  const browser = {readText:vi.fn(async () => "intentional paste"), writeText:vi.fn()};
  const electronRequire = vi.fn(() => hasElectron ? {clipboard:native} : undefined);
  const focused = vi.fn(() => true);
  vi.stubGlobal("window", {require:electronRequire, setInterval, setTimeout});
  vi.stubGlobal("document", {hasFocus:focused});
  vi.stubGlobal("navigator", {clipboard:browser});
  const plugin = Object.create(FjgTaskManagerPlugin.prototype) as any;
  plugin.systemCaptureCheckRunning = false;
  plugin.lastSystemCaptureMarker = "";
  plugin.registerDomEvent = vi.fn();
  plugin.registerInterval = vi.fn();
  plugin.openUnifiedCaptureModal = vi.fn();
  return {plugin, native, browser, electronRequire, focused};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("background clipboard privacy", () => {
  it("registers no mobile focus listener or poll, including after 60 seconds and a stale callback", async () => {
    const {plugin, native, browser, electronRequire} = harness(false);
    plugin.registerSystemCaptureClipboardWatcher();
    expect(plugin.registerDomEvent).not.toHaveBeenCalled();
    expect(plugin.registerInterval).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await plugin.consumeSystemCaptureClipboard();
    expect(native.readText).not.toHaveBeenCalled();
    expect(browser.readText).not.toHaveBeenCalled();
    expect(electronRequire).not.toHaveBeenCalled();
    expect(plugin.openUnifiedCaptureModal).not.toHaveBeenCalled();
  });

  it("retains desktop Shortcut handoff and never uses the browser clipboard", async () => {
    const {plugin, native, browser} = harness(true);
    const marker = SYSTEM_CAPTURE_CLIPBOARD_PREFIX + encodeURIComponent("Review this synthetic capture");
    native.readText.mockReturnValue(marker);
    plugin.registerSystemCaptureClipboardWatcher();
    expect(plugin.registerDomEvent).toHaveBeenCalledWith(window, "focus", expect.any(Function));
    expect(plugin.registerInterval).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(400);
    expect(native.writeText).toHaveBeenCalledExactlyOnceWith("Review this synthetic capture");
    expect(plugin.openUnifiedCaptureModal).toHaveBeenCalledExactlyOnceWith("Review this synthetic capture");
    // A focus event and repeated tick must not open the same pending handoff twice.
    plugin.registerDomEvent.mock.calls[0][2]();
    await vi.advanceTimersByTimeAsync(400);
    expect(plugin.openUnifiedCaptureModal).toHaveBeenCalledOnce();
    expect(browser.readText).not.toHaveBeenCalled();
    expect(browser.writeText).not.toHaveBeenCalled();
  });

  it("has no browser fallback when desktop Electron clipboard is absent", async () => {
    const {plugin, browser} = harness(true, false);
    plugin.registerSystemCaptureClipboardWatcher();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(browser.readText).not.toHaveBeenCalled();
    expect(plugin.openUnifiedCaptureModal).not.toHaveBeenCalled();
  });

  it("does not read while unfocused and rejects mobile even with a desktop flag", async () => {
    const {plugin, native} = harness(true);
    plugin.registerSystemCaptureClipboardWatcher();
    document.hasFocus = () => false;
    await vi.advanceTimersByTimeAsync(400);
    expect(native.readText).not.toHaveBeenCalled();
    document.hasFocus = () => true;
    platform.isMobile = true;
    await vi.advanceTimersByTimeAsync(400);
    expect(native.readText).not.toHaveBeenCalled();
  });

  it("preserves an explicit mobile Paste Clipboard action", async () => {
    const {browser} = harness(false);
    const modal = Object.create(UnifiedCaptureModal.prototype) as any;
    modal.textArea = {value:"", dispatchEvent:vi.fn(), focus:vi.fn()};
    modal.continueButton = {disabled:true};
    expect(browser.readText).not.toHaveBeenCalled();
    await modal.pasteClipboard();
    expect(browser.readText).toHaveBeenCalledOnce();
    expect(modal.textArea.value).toBe("intentional paste");
    expect(modal.continueButton.disabled).toBe(false);
  });
});
