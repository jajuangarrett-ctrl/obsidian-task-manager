import type { App } from "obsidian";
import type { IndexedTask } from "./workspace-service";

export interface DeletePreview {
  id: string; title: string; taskPath: string; roots: string[];
  files: Array<{path:string;hash:string}>; folders: string[];
  actions: string[]; externalFiles: string[]; incoming: string[]; blockers: string[];
  fingerprint: string;
}
const within=(path:string,root:string)=>path===root || path.startsWith(root+"/");
const owned=(path:string,roots:string[])=>roots.some(root=>within(path,root));
const digest=async(bytes:BufferSource)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(b=>b.toString(16).padStart(2,"0")).join("");
const hashText=(text:string)=>digest(new TextEncoder().encode(text));

/** Never calls Vault.delete or adapter.remove. Hidden files are included via the adapter. */
export async function previewObjectiveDelete(app:App, task:IndexedTask, roots:string[], others:IndexedTask[], derivedIndexes:readonly string[]=[]):Promise<DeletePreview> {
  const result:DeletePreview={id:task.record.task_id,title:task.record.title,taskPath:task.taskFile.path,roots:[],files:[],folders:[],actions:task.record.subtasks.map(a=>a.title),externalFiles:[],incoming:[],blockers:[],fingerprint:""};
  const adapter=app.vault.adapter;
  for(const root of [...new Set(roots)]) {
    if(!root || root.startsWith(".") || root.split("/").some(p=>!p||p==="."||p==="..") || root.split("/").length<3) {result.blockers.push(`Unsafe ownership root: ${root}`);continue;}
    if(await adapter.exists(root)) result.roots.push(root);
  }
  if(!result.roots.length || !owned(task.taskFile.path,result.roots)) result.blockers.push("This legacy/shared layout does not establish an exclusive objective folder. Move it to its own folder first.");
  if(task.updatesFile && !owned(task.updatesFile.path,result.roots)) result.blockers.push("The objective history is outside the owned folders.");
  if(result.roots.some((a,i)=>result.roots.some((b,j)=>i!==j&&within(a,b)))) result.blockers.push("Overlapping ownership roots.");
  const visit=async(path:string):Promise<void>=>{
    result.folders.push(path);
    const entries=await adapter.list(path);
    for(const file of entries.files.sort()) {
      if(!owned(file,result.roots)) throw Error("Folder inventory escaped its ownership root.");
      result.files.push({path:file,hash:await digest(await adapter.readBinary(file))});
      if(file.endsWith("/task.md") && file!==task.taskFile.path) result.blockers.push(`Nested objective record: ${file}`);
    }
    for(const folder of entries.folders.sort()) {if(!within(folder,path)||folder===path)throw Error("Unsafe folder inventory.");await visit(folder);}
  };
  for(const root of result.roots) await visit(root);
  // Use the adapter inventory, including hidden files and folders, rather than
  // treating stale references as evidence that a target still exists.
  const existingOwnedPaths=new Set([...result.files.map(file=>file.path),...result.folders]);
  for(const other of others) {
    if(other.record.task_id===task.record.task_id) {if(other.taskFile.path!==task.taskFile.path)result.blockers.push("Duplicate objective ID.");continue;}
    if(owned(other.taskFile.path,result.roots)) result.blockers.push(`Contains another objective: ${other.record.title}`);
    for(const ref of other.record.related_files) if(existingOwnedPaths.has(ref)) result.blockers.push(`Shared file used by ${other.record.title}: ${ref}`);
    if(other.record.subtasks.some(a=>a.source_task_id===task.record.task_id)) result.blockers.push(`An action in ${other.record.title} depends on this source objective.`);
  }
  result.externalFiles=task.record.related_files.filter(path=>!owned(path,result.roots));
  for(const action of task.record.subtasks) {
    if(action.attachment_folder && !owned(action.attachment_folder,result.roots) && await adapter.exists(action.attachment_folder))
      result.blockers.push(`Action files are outside owned folders: ${action.id}`);
  }
  const links=app.metadataCache.resolvedLinks;
  if(!links) result.blockers.push("Link index is unavailable. Wait for Obsidian indexing and preview again.");
  for(const [source,targets] of Object.entries(links||{})) {
    if(owned(source,result.roots)) {
      for(const target of Object.keys(targets))if(!owned(target,result.roots))result.externalFiles.push(target);
    } else if(Object.keys(targets).some(target=>existingOwnedPaths.has(target))) {
      result.incoming.push(source);
      for(const target of Object.keys(targets)) if(!derivedIndexes.includes(source) && existingOwnedPaths.has(target) && target!==task.taskFile.path && target!==task.updatesFile?.path)
        result.blockers.push(`File is linked from another note: ${source} → ${target}`);
    }
  }
  result.externalFiles=[...new Set(result.externalFiles)].sort();result.incoming.sort();result.blockers=[...new Set(result.blockers)].sort();result.files.sort((a,b)=>a.path.localeCompare(b.path));result.folders.sort();
  result.fingerprint=await hashText(JSON.stringify(result));return result;
}

export class ObjectiveDeleteTransaction {
  private busy=false;
  constructor(private app:App,private preview:(id:string)=>Promise<DeletePreview>){}
  async execute(approved:DeletePreview, confirmation:{title:string;acknowledgeLinks:boolean}):Promise<string> {
    if(this.busy)throw Error("Another deletion is in progress.");
    if(confirmation.title!==approved.title || !confirmation.acknowledgeLinks)throw Error("Explicit confirmation is required.");
    this.busy=true;
    const vault=this.app.vault, packageName=`Objective deletion recovery ${crypto.randomUUID()}`;
    try {
      const fresh=await this.preview(approved.id);
      if(fresh.fingerprint!==approved.fingerprint)throw Error("Contents or dependencies changed. Close this dialog and preview again.");
      if(fresh.blockers.length)throw Error(fresh.blockers.join("\n"));
      const recovery=`${fresh.roots[0].slice(0,fresh.roots[0].lastIndexOf("/"))}/${packageName}`;
      await vault.createFolder(recovery);
      const copies:Array<{path:string;hash:string;backupFile:string}>=[];
      for(const [i,file] of fresh.files.entries()) {
        const bytes=await vault.adapter.readBinary(file.path);
        if(await digest(bytes)!==file.hash)throw Error(`Contents changed before recovery copy. No objective removed; inspect ${recovery}.`);
        const backupFile=`${String(i+1).padStart(6,"0")}.bin`;
        await vault.createBinary(`${recovery}/${backupFile}`,bytes);
        if(await digest(await vault.adapter.readBinary(`${recovery}/${backupFile}`))!==file.hash)throw Error("Recovery copy verification failed. No objective removed.");
        copies.push({...file,backupFile});
      }
      await vault.create(`${recovery}/Recovery manifest.json`,JSON.stringify({version:1,createdAt:new Date().toISOString(),objectiveId:fresh.id,title:fresh.title,originalRoots:fresh.roots,files:copies,folders:fresh.folders,restore:"Original folders are recoverable in the vault .trash folder. This additional package contains exact pre-deletion bytes: restore each numbered backupFile to its corresponding original path. Never overwrite a current file without comparing it. No external linked notes were removed."},null,2));
      // Copying never renames an objective or rewrites its links. Revalidate immediately before Trash.
      const verified=await this.preview(approved.id);
      if(verified.fingerprint!==fresh.fingerprint)throw Error(`Contents or dependencies changed. No objective removed; recovery copy retained at ${recovery}. Preview again.`);
      try {
        for(const root of fresh.roots) {
          const entry=vault.getAbstractFileByPath(root);if(!entry)throw Error(`Folder disappeared: ${root}`);
          // false explicitly selects Obsidian's recoverable vault .trash on desktop AND mobile.
          await vault.trash(entry,false);
          if(await vault.adapter.exists(root))throw Error(`Trash did not remove ${root}.`);
        }
      } catch(error) {
        const failures:string[]=[];
        for(const folder of [...fresh.folders].sort((a,b)=>a.length-b.length)) {
          try {if(!await vault.adapter.exists(folder))await vault.createFolder(folder);}catch{failures.push(folder);}
        }
        for(const file of copies) {
          try {
            if(await vault.adapter.exists(file.path)) {
              if(await digest(await vault.adapter.readBinary(file.path))!==file.hash)failures.push(file.path);
            } else await vault.createBinary(file.path,await vault.adapter.readBinary(`${recovery}/${file.backupFile}`));
          } catch {failures.push(file.path);}
        }
        throw Error(`${String(error)} ${failures.length?`Some paths could not be restored without overwriting changes: ${failures.join(", ")}. Do not retry until inspected.`:"Original objective contents were restored."} Exact recovery copies remain at ${recovery}; already-trashed originals remain in .trash.`);
      }
      const packageEntry=vault.getAbstractFileByPath(recovery);
      try {if(!packageEntry)throw Error("Recovery package not indexed");await vault.trash(packageEntry,false);}
      catch{return `Original folders are in vault Trash; extra recovery package remains at ${recovery}`;}
      return `.trash/${packageName}`;
    } finally {this.busy=false;}
  }
}
