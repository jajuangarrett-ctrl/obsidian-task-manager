/** Calendar days are local dates, never UTC instants parsed from date-only strings. */
export function localDateKey(date=new Date()):string {
  return `${date.getFullYear().toString().padStart(4,"0")}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
export function validDateKey(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [y,m,d]=value.split("-").map(Number),date=new Date(0);
  date.setUTCFullYear(y,m-1,d);date.setUTCHours(0,0,0,0);
  return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;
}
/** Re-arm at midnight, check clock/timezone changes each minute, and catch suspended apps on resume. */
export function watchLocalDate(onChange:()=>void,win:EventTarget,doc:EventTarget,now:()=>Date=()=>new Date()):()=>void {
  let day=localDateKey(now()),timer:ReturnType<typeof setTimeout>,stopped=false;
  const check=()=>{
    if(stopped)return;
    clearTimeout(timer);
    const date=now(),next=localDateKey(date);
    if(next!==day){day=next;onChange();}
    const midnight=new Date(date.getFullYear(),date.getMonth(),date.getDate()+1);
    timer=setTimeout(check,Math.max(1,Math.min(60000,midnight.getTime()-date.getTime())));
  };
  win.addEventListener("focus",check);win.addEventListener("pageshow",check);doc.addEventListener("visibilitychange",check);check();
  return ()=>{stopped=true;clearTimeout(timer);win.removeEventListener("focus",check);win.removeEventListener("pageshow",check);doc.removeEventListener("visibilitychange",check);};
}
