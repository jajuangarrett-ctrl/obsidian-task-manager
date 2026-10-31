import type { IndexedTask } from "./workspace-service";
import { taskMatchesView, type TaskViewKey } from "./dashboard-model";

export const SELECTION_VIEWS = {"no-project":"Inbox folder",completed:"Completed",converted:"Converted"} as const;
export type SelectionView = keyof typeof SELECTION_VIEWS;
export const isSelectionView=(view:TaskViewKey):view is SelectionView=>view in SELECTION_VIEWS;
export const isSelectionQuestion=(question:string)=>/^(?:checked|selected) (?:objectives|items)$/i.test(question.trim());

/** Local session state only: never persisted to objectives, settings or Sync. */
export class ObjectiveSelection {
  private readonly selected=new Map<string,SelectionView>();
  revision=0;
  entries():Array<{task_id:string;selected_from:SelectionView}>{return [...this.selected].map(([task_id,selected_from])=>({task_id,selected_from}));}
  has(id:string):boolean{return this.selected.has(id);}
  set(id:string,view:SelectionView,checked:boolean):void {
    if(checked){if(this.selected.has(id))return;this.selected.set(id,view);}
    else if(!this.selected.delete(id))return;
    this.revision++;
  }
  clear():void {if(this.selected.size){this.selected.clear();this.revision++;}}
  context(tasks:IndexedTask[], unavailable:Map<string,string>=new Map(), roots:(task:IndexedTask)=>string[]=()=>[]) {
    const entries=this.entries();
    const selected=entries.map(entry=>{
      const matches=tasks.filter(task=>task.record.task_id===entry.task_id);
      const error=unavailable.get(entry.task_id)||(matches.length!==1?"Objective missing or ID is ambiguous. Refresh and reselect before acting.":"");
      if(error)return {...entry,available:false,error};
      const task=matches[0],record=task.record;
      const relationships=tasks.flatMap(parent=>parent.record.subtasks.filter(action=>action.source_task_id===record.task_id).map(action=>({parent_task_id:parent.record.task_id,parent_path:parent.taskFile.path,action_id:action.id,action_title:action.title,action_status:action.status})));
      return {...entry,available:true,title:record.title,status:record.status,path:task.taskFile.path,folder_path:task.folderPath,updates_path:task.updatesFile?.path||"",
        current_views:Object.keys(SELECTION_VIEWS).filter(view=>taskMatchesView({...record,__fjgConversionLinks:relationships},view as TaskViewKey,undefined,task.statusAssigned,task.taskFile.path)),
        workspace_roots_to_review:roots(task),related_files:record.related_files,
        converted_to:record.converted_to||null,parent_actions:relationships,
        actions:record.subtasks.map(action=>({action_id:action.id,title:action.title,source_task_id:action.source_task_id||null}))};
    });
    return {ok:true,mode:"checked-objectives",generated_at:new Date().toISOString(),selection_revision:this.revision,scope:"Current Obsidian session on this device; shared across Inbox folder, Completed and Converted views",count:selected.length,no_results:!selected.length,
      available_count:selected.filter(item=>item.available).length,tasks:selected,
      message:selected.length?"These are the explicitly checked objectives. Selection is context only, not authorization to move or delete.":"No objectives are checked. Check items in Inbox folder, Completed or Converted on this device; selection clears when the plugin reloads.",
      ownership_warning:"Folder paths and related files are context, not a verified deletion inventory. Parent objectives, converted actions, external linked files and shared folders are NOT implicitly selected. Revalidate ownership, dependencies and current paths before any operation; never infer targets from titles. Missing or ambiguous IDs must not be acted on."};
  }
}

export function renderSelectionCheckbox(parent:HTMLElement,task:IndexedTask,view:SelectionView,selection:ObjectiveSelection,changed:()=>void):void {
  const check=parent.createEl("input",{type:"checkbox",cls:"fjg-objective-select",attr:{"aria-label":`Select objective ${task.record.title} (${task.record.task_id})`}});
  check.checked=selection.has(task.record.task_id);
  check.addEventListener("click",event=>event.stopPropagation());
  check.addEventListener("change",()=>{selection.set(task.record.task_id,view,check.checked);changed();});
}

export function renderSelectionSummary(parent:HTMLElement,visible:IndexedTask[],all:IndexedTask[],view:SelectionView,selection:ObjectiveSelection,changed:()=>void):void {
  const box=parent.createDiv({cls:"fjg-objective-selection"});
  const entries=selection.entries(),visibleIds=new Set(visible.map(task=>task.record.task_id));
  const hidden=entries.filter(entry=>!visibleIds.has(entry.task_id)).length;
  box.createEl("strong",{text:`${entries.length} checked${hidden?` · ${hidden} outside this view or filter`:""}`});
  const controls=box.createDiv({cls:"fjg-objective-selection-controls"});
  const select=controls.createEl("button",{text:"Select visible"});select.disabled=!visible.length;
  select.addEventListener("click",()=>{for(const task of visible)selection.set(task.record.task_id,view,true);changed();});
  const clear=controls.createEl("button",{text:"Clear selection"});clear.disabled=!entries.length;clear.addEventListener("click",()=>{selection.clear();changed();});
  box.createEl("p",{text:"In Claudian, run /task-manager checked objectives. Then give it your instructions. Checking items does not move or delete them. Selection stays across these views and clears on plugin reload; use Claudian on this same device."});
  if(entries.length){const details=box.createEl("details");details.createEl("summary",{text:"Review all checked objectives"});
    for(const entry of entries){const task=all.find(task=>task.record.task_id===entry.task_id),line=details.createDiv();
      line.createSpan({text:`${task?.record.title||"Unavailable objective"} · ${task?.taskFile.path||entry.task_id} · checked in ${SELECTION_VIEWS[entry.selected_from]}`});
      const remove=line.createEl("button",{text:"Uncheck",attr:{"aria-label":`Uncheck ${task?.record.title||entry.task_id} (${entry.task_id})`}});remove.addEventListener("click",()=>{selection.set(entry.task_id,entry.selected_from,false);changed();});
    }
  }
}
