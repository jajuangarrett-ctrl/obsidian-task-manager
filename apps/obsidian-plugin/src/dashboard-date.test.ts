import {describe,it,expect,vi,afterEach} from "vitest";
import {localDateKey,validDateKey,watchLocalDate} from "./dashboard-date";
import {taskMatchesView} from "./dashboard-model";
import type {TaskRecord} from "@fjg/task-core";
const task=(due:string,status="ongoing")=>({due,status} as TaskRecord);
afterEach(()=>vi.useRealTimers());
describe("local calendar due views",()=>{
 it.each(["2026-01-01","2026-03-01","2026-12-31"])("partitions yesterday/today/tomorrow across %s without changing status",today=>{
  const date=new Date(today+"T12:00:00"),y=new Date(date),t=new Date(date);y.setDate(y.getDate()-1);t.setDate(t.getDate()+1);
  const records=[task(localDateKey(y)),task(today),task(localDateKey(t))],before=JSON.stringify(records);
  expect(records.map(r=>taskMatchesView(r,"due",today))).toEqual([true,true,false]);expect(records.map(r=>taskMatchesView(r,"upcoming",today))).toEqual([false,false,true]);expect(JSON.stringify(records)).toBe(before);
 });
 it.each(["","garbage","2026-02-29","2026-13-01","2026-04-31","2026-01-01T01:00:00Z"])("excludes invalid due %s",due=>{
  expect(validDateKey(due)).toBe(false);expect(taskMatchesView(task(due),"due","2026-01-01")).toBe(false);expect(taskMatchesView(task(due),"upcoming","2026-01-01")).toBe(false);
 });
 it('preserves completed, archived and converted exclusions and does not use child due dates',()=>{
  for(const status of ["completed","archived"])expect(taskMatchesView(task("2027-01-01",status),"upcoming","2026-01-01")).toBe(false);
  const converted={...task("2027-01-01"),converted_to:{parent_task_id:"parent",action_id:"action",converted_at:"today"}};
  expect(taskMatchesView(converted,"upcoming","2026-01-01")).toBe(false);
  expect(taskMatchesView({...task(""),subtasks:[{due:"2027-01-01"}]} as TaskRecord,"upcoming","2026-01-01")).toBe(false);
 });
 it('uses local calendar fields rather than UTC serialization',()=>{
  const date={getFullYear:()=>2026,getMonth:()=>11,getDate:()=>31,toISOString:()=>"2027-01-01T07:00:00Z"} as unknown as Date;
  expect(localDateKey(date)).toBe("2026-12-31");expect(validDateKey("2028-02-29")).toBe(true);
 });
 it('updates at midnight, on focus/visibility after suspension, and cleans up',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(2026,11,31,23,59,59));const win=new EventTarget(),doc=new EventTarget(),change=vi.fn();
  const stop=watchLocalDate(change,win,doc);vi.advanceTimersByTime(1000);expect(change).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date(2027,0,3,10));win.dispatchEvent(new Event("focus"));expect(change).toHaveBeenCalledTimes(2);
  vi.setSystemTime(new Date(2027,0,4,10));doc.dispatchEvent(new Event("visibilitychange"));expect(change).toHaveBeenCalledTimes(3);
  win.dispatchEvent(new Event("pageshow"));expect(change).toHaveBeenCalledTimes(3);stop();expect(vi.getTimerCount()).toBe(0);
  vi.setSystemTime(new Date(2027,0,5));win.dispatchEvent(new Event("focus"));expect(change).toHaveBeenCalledTimes(3);
  const reopened=watchLocalDate(change,win,doc);expect(change).toHaveBeenCalledTimes(3);reopened();
 });
});

it.each([[2026,2,8],[2026,10,1]])('rearms across DST calendar day %s/%s/%s', (y,m,d)=>{
 vi.useFakeTimers();const start=new Date(y,m,d),next=new Date(y,m,d+1);vi.setSystemTime(start);
 const change=vi.fn(),stop=watchLocalDate(change,new EventTarget(),new EventTarget());
 vi.advanceTimersByTime(next.getTime()-start.getTime());expect(localDateKey()).toBe(localDateKey(next));expect(change).toHaveBeenCalledOnce();stop();
});
