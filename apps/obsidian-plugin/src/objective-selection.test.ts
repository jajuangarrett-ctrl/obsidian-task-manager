import {describe,it,expect,vi} from "vitest";
import {ObjectiveSelection,checkedObjectivesPrompt,isSelectionView,renderSelectionCheckbox,renderSelectionSummary} from "./objective-selection";
import type {IndexedTask} from "./workspace-service";
const task=(id:string,title="Same title",path=`08 Tasks/Inbox/Files/${id}/task.md`)=>({record:{task_id:id,title,status:"completed",related_files:[],subtasks:[]},taskFile:{path},folderPath:path.slice(0,path.lastIndexOf('/')),updatesFile:null,statusAssigned:true} as unknown as IndexedTask);
class Element {
 children:Element[]=[];events:Record<string,(event?:any)=>void>={};checked=false;disabled=false;value="";readOnly=false;focused=false;selected=false;
 constructor(public tag="",public options:any={}){}
 createEl(tag:string,options:any={}){const el=new Element(tag,options);this.children.push(el);return el;}
 createDiv(options:any={}){return this.createEl('div',options);}createSpan(options:any={}){return this.createEl('span',options);}
 addEventListener(name:string,callback:any){this.events[name]=callback;}
 setText(text:string){this.options.text=text;}focus(){this.focused=true;}select(){this.selected=true;}
 all():Element[]{return [this,...this.children.flatMap(el=>el.all())];}
}
describe('checked objective context',()=>{
 it('deduplicates stable IDs across tabs, keeps duplicate titles distinct, and resets on reload',()=>{
  const selection=new ObjectiveSelection(),tasks=[task('a'),task('b')];
  selection.set('a','no-project',true);selection.set('a','completed',true);selection.set('b','completed',true);
  expect(selection.context(tasks).tasks.map(t=>t.task_id)).toEqual(['a','b']);
  selection.set('a','converted',false);expect(selection.context(tasks).count).toBe(1);
  expect(new ObjectiveSelection().context(tasks)).toMatchObject({count:0,no_results:true});
  selection.clear();expect(selection.context(tasks).tasks).toEqual([]);
 });
 it('uses current paths and relationships without implicitly selecting parents or actions',()=>{
  const selection=new ObjectiveSelection(),source=task('source'),parent=task('parent');
  source.record.converted_to={parent_task_id:'parent',action_id:'action',converted_at:'today'};
  parent.record.subtasks=[{id:'action',title:'Copied action',source_task_id:'source',status:'ongoing'}] as never;
  selection.set('source','converted',true);
  source.taskFile.path='02 Programs/Example/Moved/task.md';
  const result=selection.context([source,parent]);
  expect(result.tasks).toHaveLength(1);expect(result.tasks[0]).toMatchObject({path:source.taskFile.path,parent_actions:[{parent_task_id:'parent',action_id:'action'}],current_views:['converted']});
  expect(result.ownership_warning).toContain('NOT implicitly selected');
 });
 it('exposes missing and ambiguous IDs explicitly, without replacing them by matching titles',()=>{
  const s=new ObjectiveSelection();s.set('gone','completed',true);s.set('duplicate','completed',true);
  const result=s.context([task('different'),task('duplicate'),task('duplicate')]);
  expect(result).toMatchObject({count:2,available_count:0});expect(result.tasks.every(t=>!t.available)).toBe(true);
 });
 it('shows hidden selections after filtering or changing tabs, and selects only visible IDs',()=>{
  const s=new ObjectiveSelection(),a=task('a'),b=task('b'),changed=vi.fn();s.set('a','no-project',true);
  const root=new Element();renderSelectionSummary(root as never,[b],[a,b],'completed',s,changed);
  expect(root.all().some(el=>el.options.text==='1 checked · 1 outside this view or filter')).toBe(true);
  root.all().find(el=>el.options.text==='Select visible')!.events.click();expect(s.entries()).toHaveLength(2);
  root.all().find(el=>el.options.text==='Uncheck')!.events.click();expect(s.has('a')).toBe(false);expect(s.has('b')).toBe(true);
  root.all().find(el=>el.options.text==='Clear selection')!.events.click();expect(s.entries()).toEqual([]);
 });
 it.each(['no-project','completed','converted'] as const)('renders a stable-ID checkbox in %s with no objective mutation',view=>{
  const s=new ObjectiveSelection(),t=task('id'),before=JSON.stringify(t),root=new Element(),changed=vi.fn();
  renderSelectionCheckbox(root as never,t,view,s,changed);
  const check=root.children[0];expect(check.options.attr['aria-label']).toContain('(id)');check.checked=true;check.events.change();
  expect(s.has('id')).toBe(true);expect(changed).toHaveBeenCalledOnce();expect(JSON.stringify(t)).toBe(before);
  expect(isSelectionView(view)).toBe(true);expect(isSelectionView('inbox')).toBe(false);
 });
});

describe('copyable Claudian handoff',()=>{
 it('binds duplicate-title and hidden selections to exact IDs with current labels',()=>{
  const s=new ObjectiveSelection();s.set('a','no-project',true);s.set('b','converted',true);
  const prompt=checkedObjectivesPrompt(s,[task('a'),task('b')]);
  expect(prompt).toContain('node ".claude/task-manager/query.cjs" "checked objectives"');
  expect(prompt).toContain('"task_id": "a"');expect(prompt).toContain('"task_id": "b"');
  expect(prompt).toContain('complete task_id set exactly matches');expect(prompt).toContain('Do not move, delete or modify');
  s.set('a','completed',false);expect(checkedObjectivesPrompt(s,[task('a'),task('b')])).not.toContain('"task_id": "a"');
 });
 it('keeps missing IDs explicit and makes no prompt for an empty selection',()=>{
  const s=new ObjectiveSelection();expect(checkedObjectivesPrompt(s,[])).toBe('');s.set('gone','completed',true);
  expect(checkedObjectivesPrompt(s,[])).toContain('"unavailable": true');
 });
 it('copies the visible prompt, including hidden selections, without invoking an assistant',async()=>{
  const s=new ObjectiveSelection();s.set('a','completed',true);s.set('b','converted',true);
  const root=new Element(),copy=vi.fn(async()=>{});renderSelectionSummary(root as never,[task('a')],[task('a'),task('b')],'completed',s,vi.fn(),copy);
  const prompt=root.all().find(el=>el.tag==='textarea')!,button=root.all().find(el=>el.options.text==='Copy prompt')!;
  expect(prompt.readOnly).toBe(true);expect(prompt.value).toContain('"task_id": "b"');await button.events.click();
  expect(copy).toHaveBeenCalledExactlyOnceWith(prompt.value);expect(root.all().some(el=>el.options.text==='Prompt copied. Paste it into Claudian and send it.')).toBe(true);
 });
 it('offers selectable manual fallback when clipboard is unavailable',async()=>{
  const s=new ObjectiveSelection();s.set('a','completed',true);const root=new Element();
  renderSelectionSummary(root as never,[task('a')],[task('a')],'completed',s,vi.fn(),async()=>{throw Error('denied');});
  await root.all().find(el=>el.options.text==='Copy prompt')!.events.click();
  const prompt=root.all().find(el=>el.tag==='textarea')!;expect(prompt.focused&&prompt.selected).toBe(true);expect(prompt.value).toContain('"task_id": "a"');
  expect(root.all().some(el=>el.options.text?.includes('copy it manually'))).toBe(true);
 });
 it('disables empty selection and refuses a stale rendered prompt after selection changes',async()=>{
  const s=new ObjectiveSelection(),empty=new Element();renderSelectionSummary(empty as never,[],[],'completed',s,vi.fn());
  expect(empty.all().find(el=>el.options.text==='Copy prompt')!.disabled).toBe(true);
  s.set('a','completed',true);const root=new Element(),changed=vi.fn(),copy=vi.fn(async()=>{});
  renderSelectionSummary(root as never,[task('a')],[task('a')],'completed',s,changed,copy);s.set('b','converted',true);
  await root.all().find(el=>el.options.text==='Copy prompt')!.events.click();expect(copy).not.toHaveBeenCalled();expect(changed).toHaveBeenCalledOnce();
 });
});
