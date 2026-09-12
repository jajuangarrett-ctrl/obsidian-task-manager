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
 it('fills and revises fields without saving until the separate save operation',async()=>{
  const {run,values,save}=setup();let state=await run('get_capture');
  await run('update_capture',{revision:state.revision,changes:[{field:'text',value:'Discuss the revised budget'},{field:'person',value:'two'}]});
  expect(values).toEqual({text:'Discuss the revised budget',person:'two'});expect(save).not.toHaveBeenCalled();
  state=await run('get_capture');await run('update_capture',{revision:state.revision,changes:[{field:'text',value:'Discuss next week’s budget'}]});
  state=await run('get_capture');expect(await run('save_capture',{revision:state.revision})).toEqual({saved:true});expect(save).toHaveBeenCalledTimes(1);
  await expect(run('save_capture',{revision:state.revision})).rejects.toThrow('already attempted');
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
 it('requires missing fields and never retries a failed save automatically',async()=>{
  const {run,values,save}=setup();let state=await run('get_capture');await expect(run('save_capture',{revision:state.revision})).rejects.toThrow('Fill in');expect(save).not.toHaveBeenCalled();
  values.text='Text';values.person='one';save.mockRejectedValueOnce(new Error('Disk unavailable'));state=await run('get_capture');
  await expect(run('save_capture',{revision:state.revision})).rejects.toThrow('Disk');await expect(run('save_capture',{revision:state.revision})).rejects.toThrow('already attempted');expect(save).toHaveBeenCalledTimes(1);
 });
 it('reports router handoff as review opened, not a saved capture',async()=>{
  const tools=new CaptureTools({fields:()=>[],ready:()=>true,save:async()=>({review_opened:true,saved:false})},()=>true);
  const state=await tools.execute('get_capture','{}') as any;
  expect(await tools.execute('save_capture',JSON.stringify({revision:state.revision}))).toEqual({review_opened:true,saved:false});
 });
});
