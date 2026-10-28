export interface ObjectiveMenuActions {rename:()=>void;move:()=>void;addFile:()=>void;convert:()=>void;complete?:()=>void;remove:()=>void;}
/** Native details/summary works by tap and keyboard; never relies on hover. */
export function renderObjectiveMoreMenu(controls:HTMLElement,title:string,actions:ObjectiveMenuActions):HTMLDetailsElement {
  const more=controls.createEl("details",{cls:"fjg-task-more"});
  more.createEl("summary",{text:"More",attr:{"aria-label":`More actions for ${title}`}});
  const menu=more.createDiv({cls:"fjg-task-more-menu"});
  const entries:Array<[string,()=>void]>=[["Rename",actions.rename],["Move folder",actions.move],["Add file",actions.addFile],["Convert to action",actions.convert]];
  if(actions.complete)entries.push(["Complete",actions.complete]);
  entries.push(["Delete…",actions.remove]);
  for(const [label,action] of entries){const button=menu.createEl("button",{text:label,attr:{type:"button","aria-label":`${label} ${title}`}});button.addEventListener("click",()=>{more.open=false;action();});}
  return more;
}
