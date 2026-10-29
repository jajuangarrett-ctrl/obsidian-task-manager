import { Modal } from "obsidian";
import { isConvertedOriginal, statusLabel } from "@fjg/task-core";
import type FjgTaskManagerPlugin from "../main";
import type { IndexedTask } from "./workspace-service";
export function renderConversion(container:HTMLElement,task:IndexedTask,plugin:FjgTaskManagerPlugin):void {
  if(!isConvertedOriginal(task.record))return;
  const box=container.createDiv({cls:"fjg-conversion-info"});
  box.createEl("strong",{text:"Converted original — retained for reference"});
  const links=task.record.__fjgConversionLinks?.length ? task.record.__fjgConversionLinks : task.record.converted_to ? [task.record.converted_to] : [];
  if(links.length>1)box.createEl("p",{text:"Multiple ID-linked actions found. Review these references; no copies were merged."});
  for(const link of links){
    let parent:IndexedTask;try{parent=plugin.workspaceService.getById(link.parent_task_id);}catch{box.createEl("p",{text:`Parent unavailable: ${link.parent_task_id}; action ${link.action_id}. The original is preserved.`});continue;}
    const action=parent.record.subtasks.find(a=>a.id===link.action_id && a.source_task_id===task.record.task_id);
    const open=box.createEl("button",{text:`Parent: ${parent.record.title}`});open.onclick=()=>plugin.openObjectiveWorkspace(parent.record.task_id,false,true);
    if(!action){box.createEl("p",{text:`Action ${link.action_id} is unavailable. Check Sync or the parent; do not reconvert blindly.`});continue;}
    const view=box.createEl("button",{text:`Action: ${action.title} · ${statusLabel(action.status)}`});
    view.onclick=()=>{const m=new Modal(plugin.app);m.setTitle(action.title);m.contentEl.createEl("p",{text:`${statusLabel(action.status)} · Action ID: ${action.id}`});
      for(const [title,text] of [["Notes",action.notes],["History",action.history]]){m.contentEl.createEl("h3",{text:title});m.contentEl.createEl("pre",{text:text||"None",cls:"fjg-converted-history"});}
      m.contentEl.createEl("h3",{text:"Files"});for(const file of plugin.workspaceService.subtaskFiles(parent.record.task_id,action.id)){const b=m.contentEl.createEl("button",{text:file.name});b.onclick=()=>void plugin.app.workspace.getLeaf("tab").openFile(file);}m.open();};
  }
}
