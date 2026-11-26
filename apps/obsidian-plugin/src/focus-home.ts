import { Component, MarkdownRenderer, Notice, setIcon, TFolder } from "obsidian";
import { canTransition, planningDay, statusLabel, validatePlanningDay, type TaskStatus } from "@fjg/task-core";
import type FjgTaskManagerPlugin from "../main";
import type { IndexedTask } from "./workspace-service";
import { objectiveAreas } from "./area-model";
import { localDateKey } from "./dashboard-date";
import { OBJECTIVE_STATUS_CHOICES } from "./dashboard-model";
import { canScheduleFocusObjective, canUseFocusObjective, FOCUS_LISTS, focusGroups, type FocusList } from "./focus-home-model";

type Pane = 0 | 1;
type SectionToolbar = { expanded: boolean; controls: string; toggle: () => boolean };
type Draft = { title: string; notes: string; when: string; checklist: string; tags: string; destination: string };
type Undo = { text: string; apply: () => Promise<unknown> };
type Drag = { type: "objective"; id: string; path: string; prior: string } | {type:"capture"};
const emptyDraft = (when = "", destination = ""): Draft => ({title:"",notes:"",when,checklist:"",tags:"",destination});
const description = (s: string) => s.split(/\r?\n/).map(x=>x.trim())
  .filter(x=>x && !/^#{1,6}\s|^[-*]\s*\[[x ]\]/i.test(x)).slice(0,3).join(" ").slice(0,700);
const isTextInput = (el: Element | null): el is HTMLInputElement|HTMLTextAreaElement =>
  el?.tagName==="INPUT" || el?.tagName==="TEXTAREA";

export class FocusHome {
  private lists: [FocusList, FocusList] = ["today", "upcoming"];
  private activePane: Pane = 0;
  private selected: [string,string] = ["",""];
  private layout: "split" | "sidebar" | "single" = "split";
  private readonly positions = new Map<string,number>();
  private picker: Pane | null = null;
  private search = "";
  private draft?: Draft;
  private drag?: Drag;
  private undo?: Undo;
  private busy = false;
  private restoreKey = "";
  private promiseError = "";
  private scheduleId = "";
  private postpone = "";
  private detailId = "";
  private detailPath = "";
  private readingWide = false;
  private markdown?: Component;
  constructor(private plugin: FjgTaskManagerPlugin, private redraw: () => void) {}

  dispose(): void { this.markdown?.unload(); this.markdown=undefined; }

  snapshot(root: HTMLElement): void {
    this.dispose();
    root.querySelectorAll<HTMLElement>("[data-focus-scroll]").forEach(el => {
      if (el.getClientRects().length) this.positions.set(el.dataset.focusScroll!,el.scrollTop);
    });
  }

  render(root: HTMLElement, tasks: IndexedTask[], sections: SectionToolbar): void {
    const areas = objectiveAreas(this.plugin.app.vault.getAllLoadedFiles().filter(f=>f instanceof TFolder).map(f=>f.path),tasks);
    const picks = [...FOCUS_LISTS, ...areas.map(a=>({key:`area:${a.path}` as const,label:a.label,icon:"folder",tone:"blue"}))];
    const label = (key:FocusList)=>picks.find(p=>p.key===key)?.label || "Today";
    for(const p of [0,1] as const) if (!picks.some(x=>x.key===this.lists[p])) this.lists[p]=p===0?"today":"upcoming";
    const shell = root.createEl("section",{cls:"fjg-focus-home",attr:{"aria-label":"Focus Lists"}});
    shell.dataset.layout=this.layout;
    shell.dataset.activePane=String(this.activePane);
    const landscape=()=>!!shell.ownerDocument.defaultView?.matchMedia("(orientation: landscape)").matches && shell.clientWidth>=690;
    const closeDetail=()=>{
      const id=this.detailId;
      this.detailId="";this.detailPath="";this.readingWide=false;this.scheduleId="";
      jump(`focus-row-0-${id}`);
    };
    const button=(parent:HTMLElement,text:string,act:()=>void,opts:{cls?:string,icon?:string,key?:string,label?:string,pressed?:boolean}={})=>{
      const el=parent.createEl("button",{type:"button",cls:opts.cls,attr:{
        ...(opts.key?{"data-focus-key":opts.key}:{}),...(opts.label?{"aria-label":opts.label}:{}),...(opts.pressed===undefined?{}:{"aria-pressed":String(opts.pressed)})}});
      if(opts.icon) setIcon(el.createSpan({cls:"fjg-focus-icon",attr:{"aria-hidden":"true"}}),opts.icon);
      if(text) el.createSpan({text});
      el.addEventListener("click",act);return el;
    };
    const jump=(key:string)=>{this.restoreKey=key;this.redraw();};
    const run=(action:()=>Promise<unknown>,from?:HTMLButtonElement|HTMLInputElement|HTMLSelectElement)=>void this.run(action,from);
    const taskNow=(task:IndexedTask,editing=true)=>{
      const current=this.plugin.workspaceService.getById(task.record.task_id);
      if (current.taskFile.path!==task.taskFile.path || (editing && !canUseFocusObjective(current))) throw new Error("This objective changed. Reopen it before editing.");
      return current;
    };
    const changeDay=(task:IndexedTask, day:string, prior=task.record.scheduled_for||"")=>{
      if(day===prior) return;
      run(async()=>{
        const current=taskNow(task);
        const saved=await this.plugin.workspaceService.changePlanningDay(current.record.task_id,day,current.taskFile.path,prior);
        this.scheduleId="";this.undo={text:day?"Planning day updated":"Planning day cleared",apply:()=>this.plugin.workspaceService.changePlanningDay(current.record.task_id,prior,saved.taskFile.path,day)};
        this.plugin.refreshDashboard();
      });
    };
    const capture=(date="",pane:Pane=0)=>{
      const list=this.lists[pane]; this.draft??=emptyDraft(date,list.startsWith("area:")?list.slice(5):"");
      this.promiseError="";jump("focus-capture-title");
    };
    const setList=(pane:Pane,key:FocusList)=>{
      if(pane===0){this.detailId="";this.detailPath="";this.readingWide=false;}
      this.lists[pane]=key;this.selected[pane]="";this.picker=null;this.search="";this.scheduleId="";
      jump(pane===0?"focus-primary-pick":"focus-secondary-pick");
    };
    const toolbar=shell.createDiv({cls:"fjg-focus-toolbar"});
    button(toolbar,"Lists",()=>{this.picker=this.picker!==null?null:(this.detailId?0:this.activePane); this.search="";jump(this.picker!==null?"focus-jump":"focus-lists");},{icon:"panel-left",key:"focus-lists"});
    const layout=toolbar.createEl("select",{cls:"fjg-focus-layout",attr:{"aria-label":"Home layout","data-focus-key":"focus-layout"}});
    for(const [key,text] of [["split","Book Split"],["sidebar","Sidebar"],["single","Single Pane"]])layout.createEl("option",{value:key,text});
    layout.value=this.layout;layout.addEventListener("change",()=>{this.layout=layout.value as typeof this.layout;if(this.layout!=="split")this.activePane=0;this.picker=null;jump("focus-layout");});
    button(toolbar,"",()=>this.plugin.openLiveVoice(()=>JSON.stringify({mode:"home",focusList:this.lists[0],secondaryList:this.layout==="split"?this.lists[1]:undefined})),{label:"Talk to Vault",icon:"mic"});
    const trailing=toolbar.createDiv({cls:"fjg-focus-toolbar-end"});
    const add=button(trailing,"",()=>capture("",this.layout==="split"?this.activePane:0),{cls:"fjg-focus-plus",label:"Quick Entry",icon:"plus",key:"focus-add-0"});
    add.draggable=true;
    add.addEventListener("dragstart",ev=>{this.drag={type:"capture"};ev.dataTransfer?.setData("text/plain","New objective");if(ev.dataTransfer)ev.dataTransfer.effectAllowed="copy";});
    add.addEventListener("dragend",()=>{this.drag=undefined;});
    let sectionsExpanded=sections.expanded;
    const updateSectionsButton=()=>{
      const label=sectionsExpanded ? "Hide section toolbar" : "Show section toolbar";
      sectionsButton.setAttribute("aria-expanded",String(sectionsExpanded));
      sectionsButton.setAttribute("aria-label",label);
      sectionsButton.title=label;
    };
    const sectionsButton=button(trailing,"",()=>{sectionsExpanded=sections.toggle();updateSectionsButton();},
      {cls:"fjg-focus-sections-toggle",icon:"panel-top"});
    sectionsButton.setAttribute("aria-controls",sections.controls);
    updateSectionsButton();
    if(this.undo){
      const undo=this.undo, notice=shell.createDiv({cls:"fjg-focus-undo",attr:{role:"status"}});
      notice.createSpan({text:undo.text});
      button(notice,"Undo",()=>run(async()=>{await undo.apply();this.undo=undefined;this.plugin.refreshDashboard();}),{key:"focus-undo"});
      button(notice,"",()=>{this.undo=undefined;this.redraw();},{icon:"x",label:"Dismiss undo"});
    }
    if(this.promiseError && !this.draft) shell.createEl("p",{cls:"fjg-focus-error",text:this.promiseError,attr:{role:"alert"}});

    if(this.draft) {
      shell.addClass("is-capturing");
      const draft=this.draft, form=shell.createEl("form",{cls:"fjg-focus-capture",attr:{"aria-label":"Quick Entry"}});
      const head=form.createDiv({cls:"fjg-focus-capture-head"}); head.createEl("h2",{text:"New objective"});
      button(head,"Cancel",()=>{if(this.busy)return;this.draft=undefined;this.promiseError="";jump("focus-add-0");},{icon:"x"});
      const fields=form.createDiv({cls:"fjg-focus-fields"});
      const field=(label:string, key:keyof Draft, type="text")=>{
        const wrap=fields.createEl("label");wrap.createSpan({text:label});
        const input=type==="textarea"?wrap.createEl("textarea",{attr:{rows:key==="checklist"?"3":"2"}}):wrap.createEl("input",{type});
        input.value=draft[key];input.dataset.focusKey="focus-capture-"+key;
        input.addEventListener("input",()=>{draft[key]=input.value;});
        if(key==="title"){input.required=true;input.maxLength=240;}
        return input;
      };
      field("Title","title");field("Notes","notes","textarea");field("Checklist · one action per line","checklist","textarea");field("Tags · comma separated","tags");field("When · optional","when","date");
      const dest=fields.createEl("label"); dest.createSpan({text:"Save to"});
      const choose=dest.createEl("select");
      choose.createEl("option",{value:"",text:"Inbox"});
      for(const a of areas) choose.createEl("option",{value:a.path,text:a.label});
      choose.value=draft.destination;choose.addEventListener("change",()=>{draft.destination=choose.value;});
      if(this.promiseError) fields.createEl("p",{text:this.promiseError,cls:"fjg-focus-error",attr:{role:"alert"}});
      const footer=form.createDiv({cls:"fjg-focus-capture-footer"}); const save=footer.createEl("button",{type:"submit",cls:"mod-cta",text:"Save Objective"});
      save.disabled=this.busy;
      form.addEventListener("submit",event=>{event.preventDefault();run(async()=>{
        if(!draft.title.trim()) throw new Error("Enter an objective title.");
        await this.plugin.workspaceService.createTask({title:draft.title.trim(),details:draft.notes,status:"inbox",scheduledFor:validatePlanningDay(draft.when),destination:draft.destination||undefined,
          tags:draft.tags.split(",").map(t=>t.trim()).filter(Boolean),initialActions:draft.checklist.split(/\r?\n/).map(t=>t.trim()).filter(Boolean)});
        this.draft=undefined;this.restoreKey="focus-add-0";this.plugin.refreshDashboard();new Notice("Objective captured.");
      },save);});
      this.restore(shell);
      return;
    }

    const listNav=(parent:HTMLElement,pane:Pane,searchable:boolean)=>{
      const nav=parent.createEl("nav",{cls:"fjg-focus-lists",attr:{"aria-label":searchable?"Choose a focus list":"Focus lists sidebar"}});
      const populate=(target:HTMLElement,query="")=>{
        target.empty();const q=query.toLocaleLowerCase().trim();
        for(const pick of picks.filter(x=>!q || x.label.toLocaleLowerCase().includes(q))){
          const item=button(target,pick.label,()=>setList(pane,pick.key),{icon:pick.icon,pressed:this.lists[pane]===pick.key});
          item.dataset.tone=pick.tone;if(pick.key.startsWith("area:"))item.addClass("is-area");
        }
        if(!target.childElementCount)target.createEl("p",{text:"No matching lists",cls:"fjg-focus-empty"});
      };
      if(searchable){
        nav.createEl("h2",{text:pane===0?"Lists":"Second list"});
        const field=nav.createEl("input",{type:"search",placeholder:"Jump to a list",attr:{"aria-label":"Find a list","data-focus-key":"focus-jump"}});
        field.value=this.search;const options=nav.createDiv();
        field.addEventListener("input",()=>{this.search=field.value;populate(options,this.search);});
        field.addEventListener("keydown",ev=>{if(ev.key==="Enter"){ev.preventDefault();options.querySelector("button")?.click();}if(ev.key==="Escape"){this.picker=null;jump("focus-lists");}});
        populate(options,this.search);
      }else populate(nav);
    };

    if(this.picker!==null){
      const back=shell.createDiv({cls:"fjg-focus-picker"});
      button(back,"Back to list",()=>{this.picker=null;jump("focus-lists");},{icon:"chevron-left"});
      listNav(back,this.picker,true);this.restore(shell);return;
    }

    const today=localDateKey();
    const pastDueCount=focusGroups(tasks,"past-due",today,areas)[0]?.tasks.length || 0;
    const body=shell.createDiv({cls:"fjg-focus-body"});
    const focusedTask=tasks.find(t=>t.record.task_id===this.detailId && t.taskFile.path===this.detailPath && canUseFocusObjective(t));
    if(this.detailId && !focusedTask){this.detailId="";this.detailPath="";this.readingWide=false;}
    if(focusedTask){shell.addClass("has-objective-detail");shell.toggleClass("is-reading-wide",this.readingWide);}
    const sidebar=body.createDiv({cls:"fjg-focus-sidebar"}); if(this.layout==="sidebar") listNav(sidebar,0,false);
    const updateStatus=async(task:IndexedTask,target:TaskStatus|"restore")=>{
      const r=task.record,id=r.task_id;
      const current=taskNow(task);
      if(current.record.status!==r.status)throw new Error("This objective changed. Refresh before changing its status.");
      if(target!=="restore" && (target===r.status || !OBJECTIVE_STATUS_CHOICES.some(option=>option===target) || !canTransition(r.status,target))) return;
      const saved=await this.plugin.workspaceService.changeStatus(id,target);
      this.undo={text:`Status changed to ${statusLabel(saved.record.status)}`,apply:async()=>{
        const now=taskNow(saved);
        if(now.record.status!==saved.record.status || now.record.updated_at!==saved.record.updated_at)throw new Error("This objective has changed since that action.");
        await this.plugin.workspaceService.changeStatus(id,r.status);
      }};
      this.plugin.refreshDashboard();
    };
    const renderDetails=(detail:HTMLElement,task:IndexedTask,pane:Pane,full=false)=>{
      const r=task.record,id=r.task_id,done=r.status==="completed";
      const actions=r.subtasks.filter(x=>x.status!=="archived");
      if(actions.length){
        const checklist=detail.createDiv({cls:"fjg-focus-checklist"});
        checklist.createEl(full?"h3":"h4",{text:"Checklist"});
        for(const action of actions){
          const toggle=button(checklist,action.title,()=>run(async()=>{
            const current=taskNow(task),fresh=current.record.subtasks.find(x=>x.id===action.id);
            if(!fresh||fresh.status!==action.status||current.record.status==="completed")throw new Error("This action changed. Reopen it before editing.");
            await this.plugin.workspaceService.updateSubtask(id,action.id,{status:action.completed?"do-soon":"completed"});
            this.plugin.refreshDashboard();
          }),{cls:"fjg-focus-action",icon:action.completed?"circle-check":"circle",pressed:action.completed});
          toggle.disabled=done;
        }
      }
      if(full && task.notes.trim()){
        detail.createEl("h3",{text:"Objective notes"});
        const target=detail.createDiv({cls:"fjg-focus-notes markdown-rendered"});
        this.markdown=new Component();this.markdown.load();
        const component=this.markdown;
        void MarkdownRenderer.render(this.plugin.app,task.notes,target,task.taskFile.path,component)
          .catch(()=>{if(target.isConnected)target.textContent=task.notes;});
      }else {
        const preview=description(task.notes);
        if(preview)detail.createEl("p",{text:preview});
      }
      const tools=detail.createDiv({cls:"fjg-focus-tools"});
      // A native select, outside the title button, sits with the other expanded actions.
      const status=tools.createEl("select",{cls:"fjg-focus-status",attr:{"aria-label":`Status for ${r.title}`}});
      for(const value of OBJECTIVE_STATUS_CHOICES) if(canTransition(r.status,value)) status.createEl("option",{text:statusLabel(value),value});
      status.value=r.status;
      status.addEventListener("change",()=>{
        const target=status.value as TaskStatus;
        status.value=r.status;
        run(()=>updateStatus(task,target),status);
      });
      if(!done){
        button(tools,"When",()=>{this.scheduleId=this.scheduleId===id?"":id;this.postpone=r.scheduled_for||"";jump(this.scheduleId?`focus-when-${pane}-${id}`:full?"focus-objective-detail":`focus-row-${pane}-${id}`);},{icon:"calendar-days"});
        button(tools,"Deadline",()=>this.plugin.openTaskDueDateModal(id));
        button(tools,"Add action",()=>this.plugin.openObjectiveActionModal(id));
      }
      button(tools,"Files",()=>this.plugin.openObjectiveWorkspace(id,true));
      button(tools,"Updates",()=>run(()=>this.plugin.openTaskUpdates(id)));
      const more=tools.createEl("details");more.createEl("summary",{text:"More"});
      const other=more.createDiv({cls:"fjg-focus-more"});
      button(other,"Rename",()=>this.plugin.openRenameTaskModal(id));
      if(!done)button(other,"Move",()=>this.plugin.openTaskRelocationModal(id));
      button(other,"Open note",()=>run(()=>this.plugin.openTask(id)));
      if(this.scheduleId===id && !done){
        const date=detail.createDiv({cls:"fjg-focus-schedule"});
        const input=date.createEl("input",{type:"date",attr:{"aria-label":`Planning day for ${r.title}`,"data-focus-key":`focus-when-${pane}-${id}`}});input.value=this.postpone;
        input.addEventListener("input",()=>{this.postpone=input.value;});
        button(date,"Save",()=>changeDay(task,input.value));
        button(date,"Today",()=>changeDay(task,today));
        button(date,"Clear",()=>changeDay(task,""));
      }
    };
    for(const pane of [0,1] as const){
      if(pane===1 && (this.layout!=="split" || focusedTask)) continue;
      const list=this.lists[pane], scrollerKey=pane+":"+list;
      const part=body.createEl("section",{cls:`fjg-focus-pane is-pane-${pane}`,attr:{"aria-label":pane===0?"Primary focus list":"Secondary focus list"}});
      const activate=()=>{this.activePane=pane;shell.dataset.activePane=String(pane);};
      part.addEventListener("pointerdown",activate);
      part.addEventListener("focusin",activate);
      const paneHeader=part.createDiv({cls:"fjg-focus-pane-header"});
      const selectedList=picks.find(p=>p.key===list);
      const heading=paneHeader.createEl("h2",{cls:"fjg-focus-heading"});
      heading.dataset.tone=selectedList?.tone||"blue";
      setIcon(heading.createSpan({cls:"fjg-focus-list-icon",attr:{"aria-hidden":"true"}}),selectedList?.icon||"list");
      heading.createSpan({text:label(list)});
      if(list==="past-due") heading.createSpan({text:String(pastDueCount),cls:"fjg-focus-count",attr:{"aria-label":`${pastDueCount} past-due objectives`}});
      button(paneHeader,"",()=>{this.picker=pane;this.search="";jump("focus-jump");},{icon:"chevron-down",label:pane?"Choose second list":"Choose primary list",key:pane?"focus-secondary-pick":"focus-primary-pick"});
      const scroller=part.createDiv({cls:"fjg-focus-scroll",attr:{"data-focus-scroll":scrollerKey}});
      const groups=focusGroups(tasks,list,today,areas);
      if(!groups.some(g=>g.tasks.length))scroller.createEl("p",{cls:"fjg-focus-empty",text:list==="today"?"Nothing planned for today. Add an objective or schedule one from another list.":list==="past-due"?"No open objectives are past due.":"Nothing in this list yet."});
      const drop=(element:HTMLElement,day:string)=>{
        element.addEventListener("dragover",event=>{if(!this.drag || this.busy)return;event.preventDefault();element.addClass("is-drop");});
        element.addEventListener("dragleave",()=>element.removeClass("is-drop"));
        element.addEventListener("drop",event=>{
          const dragging=this.drag;this.drag=undefined;element.removeClass("is-drop");if(!dragging||this.busy)return;event.preventDefault();
          if(dragging.type==="capture")capture(day,pane);
          else {const current=tasks.find(t=>t.record.task_id===dragging.id&&t.taskFile.path===dragging.path);
            if(current&&canScheduleFocusObjective(current))changeDay(current,day,dragging.prior);}
        });
      };
      for(const group of groups){
        const section=scroller.createEl("section",{cls:"fjg-focus-group"});
        if(group.label){
          const caption=section.createDiv({cls:"fjg-focus-date"});
          caption.createEl("h3",{text:group.label});
          if(group.key==="0-overdue") {
            caption.addClass("is-past-due");
            button(caption,`View all · ${group.tasks.length}`,()=>setList(pane,"past-due"),{cls:"fjg-focus-past-due-link",label:`View all ${group.tasks.length} past-due objectives`});
          }
          if(group.scheduleDay)drop(caption,group.scheduleDay);
        }
        for(const task of group.tasks){
          const r=task.record,id=r.task_id,done=r.status==="completed", opened=this.selected[pane]===id, activeDetail=pane===0&&focusedTask?.record.task_id===id;
          const row=section.createDiv({cls:`fjg-focus-row${opened||activeDetail?" is-open":""}`});
          const check=button(row,"",()=>run(()=>updateStatus(task,done?"restore":"completed"),check),{cls:"fjg-focus-check",icon:done?"circle-check":"circle",label:`${done?"Reopen":"Complete"} ${r.title}`});
          const name=button(row,"",()=>{
            this.scheduleId="";
            if(pane===0 && landscape()){
              this.activePane=0;this.selected[0]="";this.detailId=id;this.detailPath=task.taskFile.path;
              this.positions.delete("detail:"+id);jump("focus-objective-detail");
            }else{
              this.selected[pane]=opened?"":id;jump(`focus-row-${pane}-${id}`);
            }
          },{cls:"fjg-focus-title",key:`focus-row-${pane}-${id}`});
          name.setAttribute("aria-expanded",String(opened||activeDetail));name.createSpan({text:r.title});
          const due=planningDay(r.due), past=!!due && due<today && !done;
          if(r.scheduled_for || r.due){
            const sub=name.createEl("small",{cls:"fjg-focus-meta"});
            if(r.scheduled_for)sub.createSpan({text:`Planned ${r.scheduled_for}`});
            if(r.due)sub.createSpan({text:`${past?"Past due":"Due"} ${r.due}`,cls:past?"fjg-focus-overdue":undefined});
          }
          if(canScheduleFocusObjective(task)){
            name.draggable=true;
            name.addEventListener("dragstart",ev=>{this.drag={type:"objective",id,path:task.taskFile.path,prior:r.scheduled_for||""};ev.dataTransfer?.setData("text/plain","Objective");if(ev.dataTransfer)ev.dataTransfer.effectAllowed="move";});
            name.addEventListener("dragend",()=>{this.drag=undefined;});
          }

          if(opened && !(pane===0 && focusedTask?.record.task_id===id))renderDetails(section.createDiv({cls:"fjg-focus-detail"}),task,pane);
        }
      }
      scroller.scrollTop=this.positions.get(scrollerKey)||0;
    }
    if(focusedTask){
      const r=focusedTask.record,id=r.task_id;
      const detail=body.createEl("section",{cls:"fjg-focus-reading",attr:{"aria-label":"Selected objective"}});
      const bar=detail.createDiv({cls:"fjg-focus-reading-header"});
      button(bar,"Back",closeDetail,{icon:"chevron-left",label:"Back to lists"});
      button(bar,this.readingWide?"Restore layout":"Full Width",()=>{
        this.readingWide=!this.readingWide;jump("focus-reading-width");
      },{cls:"fjg-focus-reading-width",icon:this.readingWide?"minimize-2":"maximize-2",key:"focus-reading-width"});
      const key="detail:"+id;
      const scroll=detail.createDiv({cls:"fjg-focus-scroll",attr:{"data-focus-scroll":key}});
      scroll.createEl("h2",{text:r.title,attr:{tabindex:"-1","data-focus-key":"focus-objective-detail"}});
      const meta=[statusLabel(r.status),r.scheduled_for&&`Planned ${r.scheduled_for}`,r.due&&`Due ${r.due}`].filter(Boolean);
      scroll.createEl("p",{text:meta.join(" · "),cls:"fjg-focus-reading-meta"});
      renderDetails(scroll.createDiv({cls:"fjg-focus-detail"}),focusedTask,0,true);
      scroll.scrollTop=this.positions.get(key)||0;
    }
    shell.addEventListener("keydown",event=>{
      if(event.key==="Escape" && this.scheduleId){this.scheduleId="";this.redraw();}
      else if(event.key==="Escape" && focusedTask && !isTextInput(shell.ownerDocument.activeElement) && shell.ownerDocument.activeElement?.tagName!=="SELECT"){closeDetail();}
      if(shell.ownerDocument.activeElement?.tagName==="SELECT")return;
      if((event.key==="/" || (event.key==="k"&&(event.metaKey||event.ctrlKey)))&&!isTextInput(shell.ownerDocument.activeElement)){
        event.preventDefault();event.stopPropagation();this.picker=0;this.search="";jump("focus-jump");
      }
    });
    this.restore(shell);
  }

  private restore(shell: HTMLElement): void {
    if(!this.restoreKey)return;
    const key=this.restoreKey;this.restoreKey="";
    const target=Array.from(shell.querySelectorAll<HTMLElement>("[data-focus-key]")).find(el=>el.dataset.focusKey===key&&el.getClientRects().length);
    target?.focus({preventScroll:true});
  }

  private async run(action:()=>Promise<unknown>, control?:HTMLButtonElement|HTMLInputElement|HTMLSelectElement):Promise<void>{
    if(this.busy)return;
    this.busy=true;if(control)control.disabled=true;this.promiseError="";
    try{await action();}
    catch(error){this.promiseError=error instanceof Error?error.message:String(error);this.redraw();}
    finally{this.busy=false;if(control)control.disabled=false;if(this.draft && this.promiseError)this.redraw();}
  }
}
