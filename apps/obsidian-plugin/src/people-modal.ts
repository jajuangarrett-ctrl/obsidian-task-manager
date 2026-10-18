import { App, Modal, Notice, Setting } from "obsidian";
import type FjgTaskManagerPlugin from "../main";
import { normalizePeople, personKey } from "./people-model";
export class PeopleModal extends Modal {
  private selected: string[];
  private agenda: boolean;
  constructor(app: App, private plugin: FjgTaskManagerPlugin, private taskId: string, private done?:()=>void) {
    super(app); const record=plugin.workspaceService.getById(taskId).record; this.selected=[...(record.people||[])]; this.agenda=record.agenda_selected===true;
  }
  onOpen():void { this.render(); }
  private render():void {
    this.contentEl.empty(); this.setTitle(`People: ${this.plugin.workspaceService.getById(this.taskId).record.title}`);
    this.contentEl.createEl("p",{text:"Select the employees associated with this objective. Use the same name as their agenda. Select Show on agendas to include this objective on every selected person's agenda."});
    for(const name of normalizePeople([...this.plugin.workspaceService.peopleNames(),...this.selected])) {
      new Setting(this.contentEl).setName(name).addToggle(toggle=>toggle.setValue(this.selected.some(value=>personKey(value)===personKey(name))).onChange(value=>{this.selected=this.selected.filter(item=>personKey(item)!==personKey(name));if(value)this.selected.push(name);}));
    }
    let name="";
    new Setting(this.contentEl).setName("Add a person").addText(text=>text.setPlaceholder("Exact staff display name").onChange(value=>name=value)).addButton(button=>button.setButtonText("Add").onClick(()=>{if(name.trim()){this.selected=normalizePeople([...this.selected,name]);this.render();}}));
    new Setting(this.contentEl).setName("Show on agendas").setDesc("Only open objectives appear. Completed, archived, and deselected objectives disappear after the agenda folder is refreshed. Browser meeting checkmarks do not complete the objective.").addToggle(toggle=>toggle.setValue(this.agenda).onChange(value=>this.agenda=value));
    new Setting(this.contentEl).addButton(button=>button.setButtonText("Cancel").onClick(()=>this.close())).addButton(button=>button.setButtonText("Save People").setCta().onClick(async()=>{
      button.setDisabled(true);try {await this.plugin.workspaceService.changePeople(this.taskId,this.selected,this.agenda);this.plugin.refreshDashboard();this.done?.();this.close();new Notice("People saved. Refresh the Agenda Items folder in Agenda Center to load the latest objectives.");}catch(error){new Notice(String(error));button.setDisabled(false);}
    }));
  }
  onClose():void {this.contentEl.empty();}
}
