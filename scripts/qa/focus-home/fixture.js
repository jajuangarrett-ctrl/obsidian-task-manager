import { DeleteObjectiveModal } from "../../../apps/obsidian-plugin/src/delete-objective-modal.ts";
import { TaskRelocationModal } from "../../../apps/obsidian-plugin/src/modals.ts";
import { TFile, TFolder } from "obsidian";
import { TaskDashboardView } from "../../../apps/obsidian-plugin/src/dashboard-view.ts";
import { localDateKey } from "../../../apps/obsidian-plugin/src/dashboard-date.ts";
import { addFocusDays } from "../../../apps/obsidian-plugin/src/focus-home-model.ts";
window.fixtureEvents=[];
const day=localDateKey(), tomorrow=addFocusDays(day,1), later=addFocusDays(day,3);
const area="02 Programs/Synthetic Program/Synthetic Tasks";
let id=0;
function make(title,status,other={},dest="08 Tasks/Inbox/Files") {
  const folderPath=dest+"/"+title;
  return {folderPath,taskFile:new TFile(folderPath+"/task.md"),notes:"## Notes\nSynthetic objective summary.",updates:[],relatedFiles:[],statusAssigned:true,archived:false,
    record:{task_id:"obj_"+(++id),title,status,due:"",completed_at:day+"T12:00:00Z",updated_at:day+"T12:00:00Z",priority:"normal",project:"",tags:[],people:[],delegated_to:"",subtasks:[],...other}};
}
const tasks=[
 make("Coordinate Three Temporary Counselor Offices During the Campus Renovation Across All Service Locations","waiting",{due:addFocusDays(day,-2)}),
 make("Prepare the Annual Enrollment and Outreach Report Across All Programs and Campus Locations","on-hold",{due:addFocusDays(day,-1)}),
 make("Completed overdue fixture","completed",{due:addFocusDays(day,-1)}),
 make("Confirm advisor coverage","do-first",{due:day,subtasks:[{id:"a",title:"Check draft schedule",status:"do-soon",completed:false}]}),
 make("Prepare workshop agenda","do-soon",{scheduled_for:tomorrow,due:later},area),
 make("A historical completed objective","completed"),
 make("Inbox draft","inbox"),
 make("Hold until later","on-hold"),
 make("Historical archived copy","completed",{__fjgSourceArchived:true}),
 ...Array.from({length:34},(_,i)=>make("Fixture row "+String(i).padStart(2,"0"),"do-first",{scheduled_for:day})),
 ...Array.from({length:29},(_,i)=>make("Coming row "+String(i).padStart(2,"0"),"do-soon",{scheduled_for:later})),
];
const duplicate=new Set();
const get=id=>{if(duplicate.has(id))throw Error("Conflicting copies.");const t=tasks.find(t=>t.record.task_id===id);if(!t)throw Error("Not indexed");return t;};
const app={workspace:{on:()=>()=>{}},vault:{getAllLoadedFiles:()=>[new TFolder(area)]}};
let saveGate;
const holdSave=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});saveGate={promise,resolve,reject};};
const gate=async()=>{if(saveGate){const pending=saveGate; await pending.promise;}};
const finishSave=fail=>{const pending=saveGate; saveGate=undefined;if(fail)pending.reject(new Error("Fixture save failed"));else pending.resolve();};
const service={
 list:()=>tasks,getById:get,projectNames:()=>[],peopleNames:()=>[],refresh:async()=>{},
 async createTask(p) {const t=make(p.title,p.status,{scheduled_for:p.scheduledFor,subtasks:p.initialActions.map((title,i)=>({id:"a"+i,title,status:"do-soon"})),tags:p.tags},p.destination);tasks.unshift(t);window.fixtureEvents.push({action:"capture",p});return t;},
 async changePlanningDay(id,day,path,prior){
   const t=get(id); if(path!==t.taskFile.path||prior!==(t.record.scheduled_for||""))throw Error("Stale instance");
   t.record={...t.record,scheduled_for:day};
   window.fixtureEvents.push({action:"plan",id,day,due:t.record.due}); return {...t};
 },
 async changeStatus(id,status){await gate();const t=get(id);const before=t.record.status; t.record={...t.record,status:status==="restore"?t.record.completed_from_status||"inbox":status,completed_from_status:before,updated_at:new Date().toISOString()};return {...t};},
 async updateSubtask(id,a,{status}){await gate();const r=get(id).record;const action=r.subtasks.find(x=>x.id===a);action.status=status;action.completed=status==="completed";},
};
const record=(name)=>(...args)=>window.fixtureEvents.push({action:name,args});
const plugin={app,workspaceService:service,settings:{dashboardDefault:"do-first"},refreshDashboard:()=>view.render(),openLiveVoice:record("voice"),openTaskDueDateModal:record("deadline"),openObjectiveWorkspace:record("files"),openTaskUpdates:record("updates"),openRenameTaskModal:record("rename"),openTaskRelocationModal:()=>new TaskRelocationModal(app,"Synthetic objective","08 Tasks/Inbox/Files",[
  "02 Programs/Synthetic Program","02 Programs/Synthetic Program/Long Folder Name for Wrapping on Narrow Mobile Screens",
  "03 Areas/Synthetic reference"
],async (path)=>record("move")(path)).open(),openTask:record("open"),openObjectiveActionModal:record("add-action")};
const view=new TaskDashboardView({app,containerEl:document.querySelector(".workspace-leaf")},plugin);
const openDelete=(blocked=false)=>new DeleteObjectiveModal(app,{
  id:"synthetic",title:"Synthetic objective",taskPath:"Vault/Synthetic/Objective.md",roots:["Vault/Synthetic"],
  files:[{path:"Vault/Synthetic/Attachment.md",hash:"synthetic"}],folders:["Vault/Synthetic"],
  actions:[],externalFiles:[],incoming:["Other note.md"],linkWarnings:[{source:"Other note.md",target:"Vault/Synthetic/Attachment.md",attachment:true}],
  blockers:blocked?["Contains another objective"]:[],fingerprint:"synthetic"
},async confirmation=>record("trash-preview")(confirmation)).open();
window.focusFixture={openDelete,day,tomorrow,later,holdSave,finishSave,rerender:()=>view.render(),duplicate:()=>duplicate.add(tasks.find(t=>t.record.title==="Confirm advisor coverage").record.task_id)};
view.onOpen().then(()=>{document.body.dataset.fixtureReady="true";}).catch(e=>{document.body.dataset.fixtureError=String(e);throw e;});
