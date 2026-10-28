import {describe,it,expect,vi} from "vitest";
import {ObjectiveDeleteTransaction,previewObjectiveDelete} from "./objective-delete";
import type {App} from "obsidian";
import type {IndexedTask} from "./workspace-service";

function fixture(split=false){
 const entries=new Map<string,string|null>();const roots=split?["08 Tasks/Inbox/Tasks/Test","08 Tasks/Inbox/Updates/Test","08 Tasks/Inbox/Files/Test"]:["08 Tasks/Inbox/Files/Test"];
 const folder=(p:string)=>{const bits=p.split('/');for(let i=1;i<=bits.length;i++)if(!entries.has(bits.slice(0,i).join('/')))entries.set(bits.slice(0,i).join('/'),null);};
 const put=(p:string,s:string)=>{folder(p.slice(0,p.lastIndexOf('/')));entries.set(p,s);};
 roots.forEach(folder);const taskPath=roots[0]+"/task.md",updatesPath=(split?roots[1]:roots[0])+"/updates.md";put(taskPath,"id: test\nKeep metadata");put(updatesPath,"Keep all history");put(roots.at(-1)!+"/.hidden/nested.txt","hidden evidence");put("Shared/reference.md","External note stays");
 let failRename=0,renames=0,failTrash=false,addDuringMove=false,rollbackFail=false;
 const api={
  adapter:{exists:async(p:string)=>entries.has(p),readBinary:async(p:string)=>{if(!entries.has(p)||entries.get(p)===null)throw Error('Missing '+p);return new TextEncoder().encode(entries.get(p)!).buffer;},list:async(p:string)=>{const paths=[...entries.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/'));return {files:paths.filter(k=>entries.get(k)!==null),folders:paths.filter(k=>entries.get(k)===null)};}},
  getAbstractFileByPath:(p:string)=>entries.has(p)?{path:p}:null,
  createFolder:async(p:string)=>{if(entries.has(p))throw Error('exists');folder(p);},create:async(p:string,s:string)=>put(p,s),createBinary:async(p:string,b:ArrayBuffer)=>put(p,new TextDecoder().decode(b)),
  rename:async(e:{path:string},to:string)=>{renames++;if(renames===failRename||(rollbackFail&&to===roots[0]))throw Error('rename failed');if(entries.has(to))throw Error('collision');const from=e.path;const data=[...entries].filter(([p])=>p===from||p.startsWith(from+'/'));data.forEach(([p])=>entries.delete(p));for(const [p,s]of data)entries.set(to+p.slice(from.length),s);e.path=to;if(addDuringMove){put(to+'/new-after-preview.md','New data');addDuringMove=false;}},
  trash:vi.fn(async(e:{path:string},system:boolean)=>{expect(system).toBe(false);if(failTrash)throw Error('trash failed');const from=e.path,base='.trash/'+from.split('/').pop();let to=base,n=1;while(entries.has(to))to=base+' '+n++;await api.rename(e,to);}),
  delete:vi.fn(()=>{throw Error('Permanent delete forbidden');})
 };
 const app={vault:api,metadataCache:{resolvedLinks:{}}} as unknown as App;
 const task={record:{task_id:'id-test',title:'Test',subtasks:[{title:'Keep action',source_task_id:''}],related_files:['Shared/reference.md']},taskFile:{path:taskPath},updatesFile:{path:updatesPath}} as IndexedTask;
 const others=[task];const preview=()=>previewObjectiveDelete(app,task,roots,others);const tx=new ObjectiveDeleteTransaction(app,preview);
 return {entries,roots,put,app,api,task,others,preview,tx,setFailRename:(n:number)=>failRename=n,setFailTrash:()=>failTrash=true,setAdd:()=>addDuringMove=true,setRollbackFail:()=>rollbackFail=true};
}
const confirm={title:'Test',acknowledgeLinks:true};
describe('recoverable objective deletion',()=>{
 it.each([false,true])('previews without mutation then preserves all contents in local Trash (split %s)',async split=>{const f=fixture(split),before=[...f.entries],p=await f.preview();expect([...f.entries]).toEqual(before);expect(p.files).toHaveLength(3);expect(p.actions).toEqual(['Keep action']);expect(p.externalFiles).toEqual(['Shared/reference.md']);const recovery=await f.tx.execute(p,confirm);expect(recovery).toMatch(/^\.trash\//);expect(f.api.trash).toHaveBeenCalledTimes(f.roots.length+1);expect(f.api.delete).not.toHaveBeenCalled();for(const root of f.roots)expect(f.entries.has(root)).toBe(false);for(const [,value]of before.filter(([p,v])=>v!==null&&p!=='Shared/reference.md'))expect([...f.entries.values()]).toContain(value);expect(f.entries.get('Shared/reference.md')).toBe('External note stays');expect([...f.entries.keys()].some(p=>p.includes('Recovery manifest.json'))).toBe(true);});
 it('requires exact explicit confirmation; cancellation is non-mutating',async()=>{const f=fixture(),p=await f.preview(),before=[...f.entries];await expect(f.tx.execute(p,{title:'Wrong',acknowledgeLinks:true})).rejects.toThrow('confirmation');await expect(f.tx.execute(p,{title:'Test',acknowledgeLinks:false})).rejects.toThrow('confirmation');expect([...f.entries]).toEqual(before);expect(f.api.trash).not.toHaveBeenCalled();});
 it('rejects changes after preview',async()=>{const f=fixture(),p=await f.preview();f.put(f.roots[0]+'/new.md','Keep');await expect(f.tx.execute(p,confirm)).rejects.toThrow('changed');expect(f.entries.has(f.task.taskFile.path)).toBe(true);expect(f.api.trash).not.toHaveBeenCalled();});
 it('blocks nested objectives and shared files',async()=>{const f=fixture();f.put(f.roots[0]+'/Nested/task.md','Other');f.others.push({record:{task_id:'other',title:'Other',related_files:[f.roots[0]+'/.hidden/nested.txt'],subtasks:[]},taskFile:{path:'Other/task.md'}} as unknown as IndexedTask);const p=await f.preview();expect(p.blockers.join(' ')).toMatch(/Nested/);expect(p.blockers.join(' ')).toMatch(/Shared/);await expect(f.tx.execute(p,confirm)).rejects.toThrow();expect(f.api.trash).not.toHaveBeenCalled();});
 it('blocks dependent actions and linked attachments, previews inbound objective links',async()=>{const f=fixture();f.app.metadataCache.resolvedLinks={'Another.md':{[f.task.taskFile.path]:1,[f.roots[0]+'/.hidden/nested.txt']:1}};f.others.push({record:{task_id:'other',title:'Parent',related_files:[],subtasks:[{source_task_id:'id-test'}]},taskFile:{path:'Parent/task.md'}} as unknown as IndexedTask);const p=await f.preview();expect(p.incoming).toEqual(['Another.md']);expect(p.blockers.join(' ')).toMatch(/depends/);expect(p.blockers.join(' ')).toMatch(/linked from another note/);});
 it('rolls back partial moves and never falls back to permanent delete',async()=>{const f=fixture(true),p=await f.preview();f.setFailRename(2);await expect(f.tx.execute(p,confirm)).rejects.toThrow('restored');expect(f.entries.has(f.task.taskFile.path)).toBe(true);expect(f.entries.has(f.task.updatesFile!.path)).toBe(true);expect(f.api.delete).not.toHaveBeenCalled();expect(f.api.trash).toHaveBeenCalledTimes(2);});
 it('restores original paths when Trash fails',async()=>{const f=fixture(),p=await f.preview();f.setFailTrash();await expect(f.tx.execute(p,confirm)).rejects.toThrow('restored');expect(f.entries.has(f.task.taskFile.path)).toBe(true);expect(f.api.delete).not.toHaveBeenCalled();});
 it('retains verified recovery copies if Trash fails',async()=>{const f=fixture(),p=await f.preview();f.setFailTrash();await expect(f.tx.execute(p,confirm)).rejects.toThrow('Exact recovery copies');expect([...f.entries.values()]).toContain('Keep all history');expect(f.api.delete).not.toHaveBeenCalled();});
 it('rejects concurrent confirmation',async()=>{const f=fixture(),p=await f.preview();const first=f.tx.execute(p,confirm);await expect(f.tx.execute(p,confirm)).rejects.toThrow('progress');await first;});
});

it("does not mistake the regenerated briefing index for shared attachment ownership",async()=>{
 const f=fixture();f.app.metadataCache.resolvedLinks={"Generated briefing.md":{[f.roots[0]+"/.hidden/nested.txt"]:1}};
 const p=await previewObjectiveDelete(f.app,f.task,f.roots,f.others,["Generated briefing.md"]);
 expect(p.blockers).toEqual([]);expect(p.incoming).toEqual(["Generated briefing.md"]);
});

it('detects changes during recovery copying before sending anything to Trash',async()=>{const f=fixture(),p=await f.preview();const original=f.api.createBinary;f.api.createBinary=async(path,bytes)=>{await original(path,bytes);f.put(f.roots[0]+'/arrived.md','Concurrent content');};await expect(f.tx.execute(p,confirm)).rejects.toThrow('changed');expect(f.api.trash).not.toHaveBeenCalled();expect(f.entries.get(f.roots[0]+'/arrived.md')).toBe('Concurrent content');});
