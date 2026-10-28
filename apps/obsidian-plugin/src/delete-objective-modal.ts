import {App,Modal,Notice,Setting} from "obsidian";
import type {DeletePreview} from "./objective-delete";
export class DeleteObjectiveModal extends Modal {
  constructor(app:App,private preview:DeletePreview,private submit:(confirmation:{title:string;acknowledgeLinks:boolean})=>Promise<void>){super(app);}
  onOpen():void {
    const p=this.preview;this.setTitle(`Delete objective: ${p.title}`);
    this.contentEl.createEl("p",{text:"Complete keeps your objective in place. Delete moves only the listed owned folders to this vault’s recoverable .trash folder, on desktop or mobile. Nothing is permanently deleted. External notes stay in place."});
    const list=(title:string,items:string[])=>{const d=this.contentEl.createEl("details");d.createEl("summary",{text:`${title} (${items.length})`});const ul=d.createEl("ul");for(const text of items)ul.createEl("li",{text});};
    list("Owned folders",p.roots);list("Files, including history and hidden files",p.files.map(f=>f.path));list("Actions",p.actions);list("External linked files — retained",p.externalFiles);list("Notes linking here — retained; links may need updating",p.incoming);
    if(p.blockers.length){this.contentEl.createEl("h3",{text:"Deletion blocked"});list("Resolve these dependencies before deleting",p.blockers);new Setting(this.contentEl).addButton(b=>b.setButtonText("Close").onClick(()=>this.close()));return;}
    const errorText=this.contentEl.createEl("p",{attr:{role:"alert"}});
    let title="",acknowledgeLinks=false,busy=false;
    let confirm:import("obsidian").ButtonComponent;
    const update=()=>confirm?.setDisabled(busy||title!==p.title||!acknowledgeLinks);
    new Setting(this.contentEl).setName("Type the objective title to confirm").addText(t=>t.onChange(value=>{title=value;update();}));
    new Setting(this.contentEl).setName("I reviewed the files, actions and links above").setDesc("External notes will not be deleted. Links to removed files may need updating. Recovery is available in the vault’s .trash folder; it is not a permanent backup.").addToggle(t=>t.onChange(value=>{acknowledgeLinks=value;update();}));
    new Setting(this.contentEl).addButton(b=>b.setButtonText("Cancel").onClick(()=>{if(!busy)this.close();})).addButton(b=>{confirm=b;b.setButtonText("Move to recoverable Trash").setWarning().setDisabled(true).onClick(async()=>{if(busy||title!==p.title||!acknowledgeLinks)return;busy=true;update();try{await this.submit({title,acknowledgeLinks});this.close();}catch(error){errorText.setText(String(error));new Notice(String(error),15000);}finally{busy=false;update();}});});
  }
  onClose():void{this.contentEl.empty();}
}
