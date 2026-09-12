import { describe, it, expect, vi } from 'vitest';
import { CaptureTools, type CaptureField, type CapturePort } from './capture-tools';
function setup() {
 const values={text:'',person:''}; let active=true;
 const save=vi.fn(async()=>true);
 const port:CapturePort={ready:()=>true,save,fields:()=>Object.entries(values).map(([id,value])=>({id,label:id,value,required:true,...(id==='person'?{options:[{value:'one',label:'Alex — One'},{value:'two',label:'Alex — Two'}]}:{}),set:(v:string)=>{values[id as keyof typeof values]=v;}}))};
 const tools=new CaptureTools(port,()=>active);
 const run=(name:string,args:unknown={})=>tools.execute(name,JSON.stringify(args)) as Promise<any>;
 return {values,save,run,stop:()=>active=false};
}
describe('live capture form tools',()=>{
 it('fills and revises fields while keeping all voice saves disabled',async()=>{
  const {run,values,save}=setup();let state=await run('get_capture');
  await run('update_capture',{revision:state.revision,changes:[{field:'text',value:'Discuss the revised budget'},{field:'person',value:'two'}]});
  expect(values).toEqual({text:'Discuss the revised budget',person:'two'});expect(save).not.toHaveBeenCalled();
  state=await run('get_capture');await run('update_capture',{revision:state.revision,changes:[{field:'text',value:'Discuss next week’s budget'}]});
  state=await run('get_capture');await expect(run('save_capture',{revision:state.revision})).rejects.toThrow('visible Save');expect(save).not.toHaveBeenCalled();
 });
 it('returns ambiguous people as separate choices and rejects invented option values atomically',async()=>{
  const {run,values}=setup();expect((await run('find_choices',{field:'person',query:'Alex'})).choices).toHaveLength(2);
  const state=await run('get_capture');await expect(run('update_capture',{revision:state.revision,changes:[{field:'text',value:'Must not change'},{field:'person',value:'Alex'}]})).rejects.toThrow('exact');expect(values.text).toBe('');
 });
 it('rejects stale form revisions after manual changes and stops writes when voice ends',async()=>{
  const {run,values,stop}=setup();const state=await run('get_capture');values.text='Typed correction';
  await expect(run('update_capture',{revision:state.revision,changes:[{field:'text',value:'Old speech'}]})).rejects.toThrow('form changed');
  stop();await expect(run('get_capture')).rejects.toThrow('ended');expect(values.text).toBe('Typed correction');
 });
 it('has no voice save operation, even when the form is complete',async()=>{
 const {run,values,save}=setup();values.text='Complete thought';values.person='one';const state=await run('get_capture');
 await expect(run('save_capture',{revision:state.revision})).rejects.toThrow('visible Save');expect(save).not.toHaveBeenCalled();
 });
});

it('accepts program Update text without mistaking its name for a date', async()=>{
 let value='';const tools=new CaptureTools({ready:()=>true,save:async()=>true,fields:()=>[{id:'Update',label:'Update',value,set:v=>value=v}]},()=>true);
 const state=await tools.execute('get_capture','{}') as any;
 await tools.execute('update_capture',JSON.stringify({revision:state.revision,changes:[{field:'Update',value:'Enrollment increased this week.'}]}));
 expect(value).toBe('Enrollment increased this week.');
});
