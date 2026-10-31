import {describe,it,expect,vi} from "vitest";
import {DeleteCapabilities,validDeleteProtocol} from "./delete-capability";
import type {DeletePreview} from "./objective-delete";
const preview=(id:string)=>({id,title:"Duplicate title",taskPath:`Moved/${id}/task.md`,actions:["Owned action"],blockers:[],roots:[],files:[],folders:[],externalFiles:[],incoming:[],fingerprint:"fixture"} as DeletePreview);
function setup(){let time=1000,n=0;const manager=new DeleteCapabilities(()=>time,()=>`test-${++n}`);return {manager,expire:()=>{time+=600001;},issue:(ids=["a","b"])=>manager.issue(ids,"Vault",[{title:"Label only"}])};}
describe("single-use objective deletion",()=>{
 it("fixes exact IDs, resolves fresh paths and records all owned actions without a confirmation gate",async()=>{
  const f=setup(),ids=["a","b"],issued=f.issue(ids);ids.push("unselected");const remove=vi.fn(async()=>".trash/recovery");
  expect(issued.prompt).toContain("without asking me for another confirmation");expect(issued.prompt).not.toContain("Then wait for my instructions");
  await f.manager.execute("test-1",async()=>{},async id=>preview(id),remove);
  expect(remove.mock.calls.map(call=>(call as unknown as [DeletePreview])[0].id)).toEqual(["a","b"]);
  expect(f.manager.receipt(issued.batchId)).toMatchObject({state:"completed",items:[{task_id:"a",status:"deleted",path:"Moved/a/task.md",actions:["Owned action"]},{task_id:"b",status:"deleted"}]});
 });
 it("reports blocked dependencies and continues independent targets without touching parents",async()=>{
  const f=setup(),issued=f.issue(),remove=vi.fn(async()=>".trash/recovery");
  await f.manager.execute("test-1",async()=>{},async id=>({...preview(id),blockers:id==="a"?["Parent depends on source"]:[]}),remove);
  expect(remove).toHaveBeenCalledOnce();expect(f.manager.receipt(issued.batchId)?.items.map(i=>i.status)).toEqual(["blocked","deleted"]);
 });
 it("rejects expiry, replay, another vault session and substitutions",async()=>{
  const f=setup(),issued=f.issue(),operation=vi.fn();
  expect(await new DeleteCapabilities().execute("test-1",operation,operation,operation)).toBe(false);
  expect(await f.manager.execute("substitute",operation,operation,operation)).toBe(false);
  f.expire();expect(await f.manager.execute("test-1",operation,operation,operation)).toBe(false);
  expect(f.manager.receipt(issued.batchId)?.state).toBe("expired");expect(operation).not.toHaveBeenCalled();
  const g=setup();g.issue();await g.manager.execute("test-1",async()=>{},async id=>preview(id),async()=>"recovery");
  expect(await g.manager.execute("test-1",operation,operation,operation)).toBe(false);
 });
 it("consumes before awaiting and blocks simultaneous batches",async()=>{
  const f=setup(),first=f.issue();let unblock!:()=>void;
  const run=f.manager.execute("test-1",()=>new Promise<void>(resolve=>{unblock=resolve;}),async id=>preview(id),async()=>"recovery");
  const operation=vi.fn();expect(await f.manager.execute("test-1",operation,operation,operation)).toBe(false);
  const second=f.issue();await f.manager.execute("test-3",operation,operation,operation);
  expect(f.manager.receipt(second.batchId)?.items.every(i=>i.status==="blocked")).toBe(true);expect(operation).not.toHaveBeenCalled();
  unblock();await run;expect(f.manager.receipt(first.batchId)?.state).toBe("completed");
 });
 it("reports identity changes, transaction rollback failures and preparation failure without retrying",async()=>{
  const f=setup(),issued=f.issue();const remove=vi.fn(async()=>{throw Error("Original contents restored; recovery retained");});
  await f.manager.execute("test-1",async()=>{},async id=>preview(id==="a"?"different":id),remove);
  expect(f.manager.receipt(issued.batchId)?.items).toMatchObject([{status:"blocked",error:"Objective identity changed."},{status:"blocked",error:"Original contents restored; recovery retained"}]);
  const next=f.issue();await f.manager.execute("test-3",async()=>{throw Error("index unavailable");},async id=>preview(id),remove);
  expect(f.manager.receipt(next.batchId)?.items.every(i=>i.error==="index unavailable")).toBe(true);
 });
 it("rejects empty and duplicated IDs and protects receipt state from callers",()=>{
  const f=setup();expect(()=>f.issue([])).toThrow();expect(()=>f.issue(["a","a"])).toThrow();const issued=f.issue();
  f.manager.receipt(issued.batchId)!.items[0].task_id="other";expect(f.manager.receipt(issued.batchId)!.items[0].task_id).toBe("a");
 });
});

it('accepts consumed vault routing but rejects alternate vault, extra IDs/paths and malformed protocol data',()=>{
 const params={action:'fjg-objective-delete',capability:'00000000-0000-0000-0000-000000000000'};
 expect(validDeleteProtocol(params,'Vault')).toBe(true);expect(validDeleteProtocol({...params,vault:'Vault'},'Vault')).toBe(true);
 expect(validDeleteProtocol({...params,vault:'Other'},'Vault')).toBe(false);
 for(const key of ['path','ids','task_id'])expect(validDeleteProtocol({...params,[key]:'other'},'Vault')).toBe(false);
 expect(validDeleteProtocol({...params,action:'other'},'Vault')).toBe(false);expect(validDeleteProtocol({...params,capability:'bad'},'Vault')).toBe(false);
});
