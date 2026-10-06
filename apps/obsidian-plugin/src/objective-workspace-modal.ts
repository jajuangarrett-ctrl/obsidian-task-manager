import { App, Component, MarkdownRenderer, Modal, Notice, TFile, TFolder } from "obsidian";
import { statusLabel } from "@fjg/task-core";
import type FjgTaskManagerPlugin from "../main";
import { nextObjectiveAction } from "./home-model";

export class ObjectiveWorkspaceModal extends Modal {
  private tab: "brief" | "actions" | "folder";
  private browsePath = "";
  private generation = 0;
  private readonly markdownComponent = new Component();
  constructor(app: App, private readonly plugin: FjgTaskManagerPlugin, private readonly taskId: string, folder = false, actions = false) {
    super(app); this.tab = folder ? "folder" : actions ? "actions" : "brief";
  }
  onOpen(): void { this.modalEl.addClass("fjg-objective-workspace-shell"); void this.render(); }
  onClose(): void { this.generation++; this.markdownComponent.unload(); this.contentEl.empty(); }
  private button(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { text: label, attr: { type: "button" } }); button.addEventListener("click", action); return button;
  }
  private async render(): Promise<void> {
    const generation = ++this.generation;
    this.markdownComponent.unload(); this.markdownComponent.load();
    this.contentEl.empty();
    try {
      const service = this.plugin.workspaceService, task = service.getById(this.taskId);
      this.setTitle(task.record.title);
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
      body.createEl("p",{text:`${statusLabel(task.record.status)} · ${task.record.due?`Due ${task.record.due}`:"No due date"} · Updated ${task.record.updated_at.slice(0,10)}`,cls:"fjg-workspace-status"});
      body.createEl("code",{text:task.taskFile.path,cls:"fjg-workspace-path"});
      const controls=body.createDiv({cls:"fjg-workspace-controls"});
      this.button(controls,"Open objective note",()=>void this.plugin.openTask(this.taskId));
      this.button(controls,"Update",()=>this.plugin.openUpdateModal(this.taskId));
      if(!task.archived)this.button(controls,"Add action",()=>this.plugin.openObjectiveActionModal(this.taskId,()=>void this.render()));
      if(this.tab==="actions") {
        for(const sub of task.record.subtasks){const row=body.createDiv({cls:"fjg-workspace-action"});const check=row.createEl("input",{type:"checkbox",attr:{"aria-label":`Complete ${sub.title}`}});check.checked=sub.completed;check.disabled=task.archived;row.createSpan({text:`${sub.title} · ${statusLabel(sub.status)}${sub.due?` · Due ${sub.due}`:""}`});check.addEventListener("change",async()=>{check.disabled=true;try{await service.updateSubtask(this.taskId,sub.id,{status:check.checked?"completed":"do-soon"});void this.render();this.plugin.refreshDashboard();}catch(error){new Notice(String(error));void this.render();}});}
        if(!task.record.subtasks.length)body.createEl("p",{text:"No actions yet. Add your first step."}); return;
      }
      body.createEl("h3",{text:"Next action"});body.createEl("p",{text:nextObjectiveAction(task.record)});
      const brief=service.startHereFile(this.taskId);
      body.createEl("h3",{text:"Objective brief"});
      if(brief){this.button(body,"Edit Start Here note",()=>void this.app.workspace.getLeaf("tab").openFile(brief));const content=await this.app.vault.read(brief);if(generation!==this.generation)return;await MarkdownRenderer.render(this.app,content,body.createDiv({cls:"fjg-start-here-markdown"}),brief.path,this.markdownComponent);}
      else {body.createEl("p",{text:"Create a Start Here note for the outcome, open questions, waiting items and key files. Status and next action above stay linked to the objective record."});const create=this.button(body,"Create Start Here note",()=>{create.disabled=true;void service.ensureStartHereNote(this.taskId).then(file=>{void this.app.workspace.getLeaf("tab").openFile(file);void this.render();}).catch(error=>{new Notice(String(error));create.disabled=false;});});create.disabled=task.archived;}
      body.createEl("h3",{text:"Key files"});
      const files=service.objectiveFiles(this.taskId);for(const related of files){this.button(body,related.file.name,()=>void this.app.workspace.getLeaf("tab").openFile(related.file));body.createEl("code",{text:related.file.path,cls:"fjg-workspace-path"});}if(!files.length)body.createEl("p",{text:"No supporting files yet."});
    } catch(error){this.contentEl.createEl("p",{text:`Unable to open this objective: ${String(error)}`,cls:"fjg-workspace-error"});}
  }
}
