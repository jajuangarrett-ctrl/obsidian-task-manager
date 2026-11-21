import { ItemView, type WorkspaceLeaf } from "obsidian";

export const LIVE_CONVERSATION_VIEW = "fjg-live-conversation";

/** A native workspace pane. Owns no session, note contents, or independent microphone. */
export class LiveConversationView extends ItemView {
  private onConversationClose?: () => void;
  constructor(leaf: WorkspaceLeaf) { super(leaf); }
  getViewType(): string { return LIVE_CONVERSATION_VIEW; }
  getDisplayText(): string { return "Talk to Vault"; }
  getIcon(): string { return "messages-square"; }
  async onOpen(): Promise<void> {
    this.contentEl.addClass("fjg-live-pane-host");
    this.contentEl.createEl("p", { text: "Open Talk to Dashboard to start a new conversation. Restoring a workspace never starts a microphone." });
  }
  attachConversation(content: HTMLElement, onClose: () => void): void {
    if (content.ownerDocument !== this.contentEl.ownerDocument) throw new Error("Keep this conversation in its original window.");
    this.contentEl.empty();
    this.contentEl.appendChild(content);
    this.onConversationClose = onClose;
  }
  releaseConversation(): void { this.onConversationClose = undefined; }
  async onClose(): Promise<void> {
    const close = this.onConversationClose; this.onConversationClose = undefined; close?.();
  }
}
