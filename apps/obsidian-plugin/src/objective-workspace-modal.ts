import { isConvertedOriginal } from "@fjg/task-core";
import { renderConversion } from "./conversion-ui";
import { App, Component, MarkdownRenderer, Modal, Notice, TFile, TFolder } from "obsidian";
import { statusLabel } from "@fjg/task-core";
import type FjgTaskManagerPlugin from "../main";
import type { IndexedTask } from "./workspace-service";
import { nextObjectiveAction } from "./home-model";
import { canEditAppObjective } from "./objectives-app-model";
import { renderObjectiveFileReviewActions, renderObjectiveFilesDisclosure } from "./objective-file-review-ui";

const APP_DETAIL_SECTIONS = ["Overview", "Actions", "Files", "History"] as const;
type AppDetailSection = typeof APP_DETAIL_SECTIONS[number];

export class ObjectiveWorkspaceContent {
  private tab: "brief" | "actions" | "folder";
  private browsePath = "";
  private generation = 0;
  private readonly markdownComponent = new Component();
  private disposed = false;
  private mobileMoreOpen = false;
  private mobileFilesOpen = false;
  private appSection: AppDetailSection = "Overview";
  constructor(private readonly app: App, private readonly plugin: FjgTaskManagerPlugin, private readonly taskId: string,
    readonly contentEl: HTMLElement, private readonly setTitle: (title: string) => void, folder = false, actions = false,
    private readonly mobileOverview: boolean | "app" = false) {
    this.tab = folder ? "folder" : actions ? "actions" : "brief";
  }
  dispose(): void { this.disposed = true; this.generation++; this.markdownComponent.unload(); this.contentEl.empty(); }
  refresh(): void { void this.render(); }
  private button(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { text: label, attr: { type: "button" } }); button.addEventListener("click", action); return button;
  }
  private async render(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.markdownComponent.unload(); this.markdownComponent.load();
    this.contentEl.empty();
    try {
      const service = this.plugin.workspaceService, task = service.getById(this.taskId);
      this.setTitle(task.record.title);
      if (this.mobileOverview === "app") {
        this.renderAppDetails(task);
        return;
      }
      if (this.mobileOverview) {
        this.renderMobileOverview(task);
        return;
      }
      const tabs = this.contentEl.createDiv({ cls: "fjg-workspace-tabs", attr: { role: "tablist", "aria-label": "Objective workspace" } });
      for (const [key,label] of [["brief","Start Here"],["actions","Actions"],["folder","Folder browser"]] as const) {
        const b=this.button(tabs,label,()=> { this.tab=key; void this.render(); }); b.setAttribute("role","tab"); b.setAttribute("aria-selected",String(this.tab===key)); b.toggleClass("is-active",this.tab===key);
      }
      const body=this.contentEl.createDiv({ cls:"fjg-workspace-body" });
      if(this.tab==="folder") {
        this.browsePath ||= task.taskFile.parent?.path || task.folderPath;
        const folder=this.app.vault.getAbstractFileByPath(this.browsePath);
        body.createEl("code",{text:this.browsePath,cls:"fjg-workspace-path"});
        if(!(folder instanceof TFolder)){body.createEl("p",{text:"This folder moved or is unavailable. Reopen the objective to resolve its current location."});return;}
        this.button(body,"Objective folder",()=>{this.browsePath=service.getById(this.taskId).taskFile.parent?.path||task.folderPath;void this.render();});
        if(folder.parent)this.button(body,"Parent folder",()=>{this.browsePath=folder.parent!.path;void this.render();});
        const list=body.createDiv({cls:"fjg-workspace-file-list"});
        for(const entry of [...folder.children].sort((a,b)=>Number(b instanceof TFolder)-Number(a instanceof TFolder)||a.name.localeCompare(b.name)))this.button(list,`${entry instanceof TFolder?"Folder: ":""}${entry.name}`,()=>{if(entry instanceof TFolder){this.browsePath=entry.path;void this.render();}else if(entry instanceof TFile)void this.app.workspace.getLeaf("tab").openFile(entry);});
        if(!folder.children.length)list.createEl("p",{text:"This folder is empty."});
        return;
      }
      renderConversion(body,task,this.plugin);
      body.createEl("p",{text:`${isConvertedOriginal(task.record)?"Converted original":statusLabel(task.record.status)} · ${task.record.due?`Due ${task.record.due}`:"No due date"} · Updated ${task.record.updated_at.slice(0,10)}`,cls:"fjg-workspace-status"});
      body.createEl("code",{text:task.taskFile.path,cls:"fjg-workspace-path"});
      const controls=body.createDiv({cls:"fjg-workspace-controls"});
      this.button(controls,"Open objective note",()=>void this.plugin.openTask(this.taskId));
      if(!task.archived)this.button(controls,`People: ${(task.record.people||[]).join(", ")||"None"}`,()=>this.plugin.openPeoplePicker(this.taskId,()=>void this.render()));
      this.button(controls,"Update",()=>this.plugin.openUpdateModal(this.taskId));
      if(!task.archived)this.button(controls,"Add action",()=>this.plugin.openObjectiveActionModal(this.taskId,()=>void this.render()));
      if(this.tab==="actions") {
        this.renderActions(body, task);
        return;
      }
      body.createEl("h3",{text:"Next action"});body.createEl("p",{text:nextObjectiveAction(task.record)});
      const brief=service.startHereFile(this.taskId);
      body.createEl("h3",{text:"Objective brief"});
      if(brief){this.button(body,"Edit Start Here note",()=>void this.app.workspace.getLeaf("tab").openFile(brief));const content=await this.app.vault.read(brief);if(generation!==this.generation)return;await MarkdownRenderer.render(this.app,content,body.createDiv({cls:"fjg-start-here-markdown"}),brief.path,this.markdownComponent);}
      else {body.createEl("p",{text:"Create a Start Here note for the outcome, open questions, waiting items and key files. Status and next action above stay linked to the objective record."});const create=this.button(body,"Create Start Here note",()=>{create.disabled=true;void service.ensureStartHereNote(this.taskId).then(file=>{void this.app.workspace.getLeaf("tab").openFile(file);void this.render();}).catch(error=>{new Notice(String(error));create.disabled=false;});});create.disabled=task.archived;}
      const fileHeading = body.createDiv({ cls: "fjg-objective-files-heading" });
      fileHeading.createEl("h3", { text: "Key files" });
      const observedPath = task.taskFile.path;
      renderObjectiveFileReviewActions(fileHeading, (mode) => this.plugin.openObjectiveFileReview(this.taskId, observedPath, mode),
        () => this.plugin.openObjectiveChat(this.taskId, observedPath));
      this.renderFiles(body, service.objectiveFiles(this.taskId), true);
    } catch(error){this.contentEl.createEl("p",{text:`Unable to open this objective: ${String(error)}`,cls:"fjg-workspace-error"});}
  }

  private selectAppSection(section: AppDetailSection, fromShortcut = false): void {
    this.appSection = section;
    void this.render();
    const target = fromShortcut
      ? this.contentEl.querySelector<HTMLElement>(".fjg-app-detail-content")
      : this.contentEl.querySelector<HTMLElement>('.fjg-app-detail-tabs button[aria-pressed="true"]');
    target?.focus({ preventScroll: true });
    if (fromShortcut) target?.scrollIntoView({ block: "nearest" });
  }

  private renderAppDetails(task: IndexedTask): void {
    const service = this.plugin.workspaceService;
    const { record } = task;
    const observedPath = task.taskFile.path;
    const controls = this.contentEl.createDiv({ cls: "fjg-overview-mobile-controls", attr: { role: "group", "aria-label": "Objective shortcuts" } });
    this.button(controls, "Show in Files", () => this.selectAppSection("Files", true));
    this.button(controls, "Copy Path", () => {
      this.runAppAction(observedPath, () => this.plugin.copyTaskFolderPath(this.taskId, { createMissing: false }));
    });
    this.button(controls, "Update", () => {
      this.runAppAction(observedPath, () => this.plugin.openUpdateModal(this.taskId, { appView: true }), true);
    }).disabled = !canEditAppObjective(task);

    const tabs = this.contentEl.createEl("nav", { cls: "fjg-app-detail-tabs", attr: { "aria-label": "Objective detail sections" } });
    for (const section of APP_DETAIL_SECTIONS) {
      const button = this.button(tabs, section, () => this.selectAppSection(section));
      button.setAttribute("aria-pressed", String(this.appSection === section));
    }
    const status = isConvertedOriginal(record) ? "Converted original" : task.statusAssigned ? statusLabel(record.status) : "Unassigned status";
    this.contentEl.createEl("p", { text: [status, record.project, record.due ? `Due ${record.due}` : ""].filter(Boolean).join(" · "), cls: "fjg-workspace-status" });
    renderConversion(this.contentEl, task, this.plugin);
    const body = this.contentEl.createEl("section", { cls: "fjg-app-detail-content", attr: { "aria-label": this.appSection, tabindex: "-1" } });
    if (this.appSection === "Actions") {
      const heading = body.createDiv({ cls: "fjg-overview-mobile-actions-heading" });
      heading.createEl("h3", { text: "Actions" });
      const add = this.button(heading, "Add action", () => this.runAppAction(observedPath, () =>
        this.plugin.openObjectiveActionModal(this.taskId, () => {}, { appView: true }), true));
      add.disabled = !canEditAppObjective(task) || record.status === "completed";
      this.renderActions(body, task);
      return;
    }
    if (this.appSection === "Files") {
      const fileHeading = body.createDiv({ cls: "fjg-objective-files-heading" });
      fileHeading.createEl("h3", { text: "Related files" });
      renderObjectiveFileReviewActions(fileHeading, (mode) => this.plugin.openObjectiveFileReview(this.taskId, observedPath, mode),
        () => this.plugin.openObjectiveChat(this.taskId, observedPath));
      body.createEl("code", { text: service.copyFolderForTask(this.taskId).folderPath, cls: "fjg-workspace-path" });
      const files = service.objectiveFiles(this.taskId);
      this.renderFiles(body.createDiv({ cls: "fjg-workspace-file-list" }), files, false, observedPath);
      return;
    }
    if (this.appSection === "History") {
      body.createEl("h3", { text: "Progress history" });
      if (task.updatesFile) this.button(body, "Open full update log", () =>
        this.runAppAction(observedPath, () => this.plugin.openTaskUpdates(this.taskId)));
      if (!task.updates.length) body.createEl("p", { text: "No updates yet." });
      for (const update of task.updates.slice(0, 20)) {
        const entry = body.createEl("article", { cls: "fjg-app-history-entry" });
        entry.createEl("strong", { text: [update.timestamp, update.actor].filter(Boolean).join(" · ") });
        entry.createEl("p", { cls: "fjg-app-note-preview", text: previewText(update.text) });
      }
      return;
    }
    if (record.subtasks.length) {
      const complete = record.subtasks.filter(item => item.completed).length;
      body.createEl("h3", { text: "Action progress" });
      const progress = body.createEl("progress", {
        cls: "fjg-app-progress", attr: { max: String(record.subtasks.length), value: String(complete), "aria-label": "Action progress" },
      });
      progress.createSpan({ text: `${complete} of ${record.subtasks.length}` });
      this.button(body, "View actions", () => this.selectAppSection("Actions", true));
    }
    body.createEl("h3", { text: "Next action" });
    body.createEl("p", { text: nextObjectiveAction(record) });
    if (task.notes.trim()) {
      body.createEl("h3", { text: "Objective notes" });
      body.createEl("p", { cls: "fjg-app-note-preview", text: previewText(task.notes) });
    }
    this.button(body, "Open objective note", () => this.runAppAction(observedPath, () => this.plugin.openTask(this.taskId)));
  }

  private runAppAction(observedPath: string, action: () => void | Promise<void>, editing = false): void {
    try {
      this.assertAppTask(observedPath, editing);
      void Promise.resolve(action()).catch(error => new Notice(error instanceof Error ? error.message : String(error)));
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
  }

  private assertAppTask(observedPath: string, editing: boolean): void {
    const current = this.plugin.workspaceService.getById(this.taskId);
    if (this.disposed || current.taskFile.path !== observedPath || (editing && !canEditAppObjective(current))) {
      throw new Error("This objective changed or is now read-only. Reopen it to continue.");
    }
  }

  private renderMobileOverview(task: IndexedTask): void {
    const body = this.contentEl.createDiv({ cls: "fjg-overview-mobile-body" });
    body.createEl("p", { text: `${isConvertedOriginal(task.record) ? "Converted original" : statusLabel(task.record.status)} · ${task.record.due ? `Due ${task.record.due}` : "No due date"}`, cls: "fjg-workspace-status" });
    const controls = body.createDiv({ cls: "fjg-overview-mobile-controls", attr: { role: "group", "aria-label": "Objective shortcuts" } });
    this.button(controls, "Show in Files", () => void this.plugin.showTaskFileLocationInFileFocus(this.taskId))
      .setAttribute("aria-label", "Show objective attachments in FJG File Focus");
    this.button(controls, "Copy path", () => void this.plugin.copyTaskFolderPath(this.taskId))
      .setAttribute("aria-label", "Copy objective attachments folder path");
    this.button(controls, "Update", () => this.plugin.openUpdateModal(this.taskId));

    const actions = body.createEl("section", { cls: "fjg-overview-mobile-actions", attr: { "aria-label": "Actions" } });
    const actionsHeading = actions.createDiv({ cls: "fjg-overview-mobile-actions-heading" });
    actionsHeading.createEl("h3", { text: "Actions" });
    if (!task.archived) this.button(actionsHeading, "Add action", () => this.plugin.openObjectiveActionModal(this.taskId, () => void this.render()));
    this.renderActions(actions, task);

    renderConversion(body, task, this.plugin);
    const files = this.plugin.workspaceService.objectiveFiles(this.taskId);
    const observedPath = task.taskFile.path;
    renderObjectiveFilesDisclosure(body, {
      count: files.length,
      initiallyOpen: this.mobileFilesOpen,
      onToggle: (open) => { this.mobileFilesOpen = open; },
      openReview: (mode) => this.plugin.openObjectiveFileReview(this.taskId, observedPath, mode),
      openChat: () => this.plugin.openObjectiveChat(this.taskId, observedPath),
    }, (section) => this.renderFiles(section.createDiv({ cls: "fjg-workspace-file-list" }), files, false));

    const secondary = body.createEl("details", { cls: "fjg-overview-mobile-secondary" });
    secondary.open = this.mobileMoreOpen;
    secondary.createEl("summary", { text: "More objective options" });
    secondary.addEventListener("toggle", () => { if (this.contentEl.contains(secondary)) this.mobileMoreOpen = secondary.open; });
    const more = secondary.createDiv({ cls: "fjg-workspace-controls" });
    this.button(more, "Open objective note", () => void this.plugin.openTask(this.taskId));
    if (!task.archived) this.button(more, `People: ${(task.record.people || []).join(", ") || "None"}`,
      () => this.plugin.openPeoplePicker(this.taskId, () => void this.render()));
    more.createEl("p", { text: `Updated ${task.record.updated_at.slice(0, 10)}` });
  }

  private renderActions(parent: HTMLElement, task: IndexedTask): void {
    const observedPath = task.taskFile.path;
    for (const sub of task.record.subtasks) {
      const row = parent.createEl(this.mobileOverview ? "label" : "div", { cls: "fjg-workspace-action" });
      const check = row.createEl("input", { type: "checkbox", attr: { "aria-label": `Complete ${sub.title}` } });
      check.checked = sub.completed;
      check.disabled = this.mobileOverview === "app" ? !canEditAppObjective(task) : task.archived;
      row.createSpan({ text: `${sub.title} · ${statusLabel(sub.status)}${sub.due ? ` · Due ${sub.due}` : ""}` });
      check.addEventListener("change", async () => {
        check.disabled = true;
        try {
          if (this.mobileOverview === "app") this.assertAppTask(observedPath, true);
          await this.plugin.workspaceService.updateSubtask(this.taskId, sub.id, { status: check.checked ? "completed" : "do-soon" });
          void this.render();
          this.plugin.refreshDashboard();
        } catch (error) {
          new Notice(String(error));
          void this.render();
        }
      });
    }
    if (!task.record.subtasks.length) parent.createEl("p", { text: this.mobileOverview && task.archived ? "No actions." : "No actions yet. Add your first step." });
  }

  private renderFiles(parent: HTMLElement, files: ReturnType<FjgTaskManagerPlugin["workspaceService"]["objectiveFiles"]>, showPath: boolean, appPath?: string): void {
    for (const related of files) {
      const path = related.file.path;
      const openFile = this.button(parent, related.file.name, () => {
        if (!appPath) { void this.app.workspace.getLeaf("tab").openFile(related.file); return; }
        this.runAppAction(appPath, async () => {
          const fresh = this.plugin.workspaceService.objectiveFiles(this.taskId).find(item => item.file.path === path);
          if (!fresh) throw new Error("That related file is no longer available.");
          await this.app.workspace.getLeaf("tab").openFile(fresh.file, { active: true });
        });
      });
      if (showPath) parent.createEl("code", { text: related.file.path, cls: "fjg-workspace-path" });
      else openFile.setAttribute("title", related.file.path);
    }
    if (!files.length) parent.createEl("p", { text: "No supporting files yet." });
  }
}

function previewText(text: string): string {
  const limit = 6000;
  return text.length <= limit ? text : text.slice(0, limit) + "\n… Open the original note to read more.";
}

export class ObjectiveWorkspaceModal extends Modal {
  private workspace?: ObjectiveWorkspaceContent;
  constructor(app: App, private readonly plugin: FjgTaskManagerPlugin, private readonly taskId: string, private readonly folder = false, private readonly actions = false) { super(app); }
  onOpen(): void {
    this.modalEl.addClass("fjg-objective-workspace-shell");
    this.workspace = new ObjectiveWorkspaceContent(this.app, this.plugin, this.taskId, this.contentEl, title => this.setTitle(title), this.folder, this.actions);
    this.workspace.refresh();
  }
  onClose(): void { this.workspace?.dispose(); this.workspace = undefined; }
}
