import type { App } from 'obsidian';
import { CaptureLiveSession } from './session';
import { CaptureTools, type CaptureField, type CapturePort } from './capture-tools';
export function inputField(id: string, label: string, input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, required=false): CaptureField {
  return {id,label,value:input.value,required,...(input.tagName==='SELECT'?{options:Array.from((input as HTMLSelectElement).options).map(o=>({value:o.value,label:o.text}))}:{}),set(value){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}};
}
export function settingFields(root: HTMLElement, required: string[]=[]): CaptureField[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.setting-item')).flatMap(row=>{
    const label=row.querySelector('.setting-item-name')?.textContent||'';
    const input=row.querySelector<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input:not([type=password]),textarea,select');
    return input&&label?[inputField(label,label,input,required.includes(label))]:[];
  });
}
export async function captureKey(app: App, own=''): Promise<string> {
  if(own.trim())return own;
  const plugin=(app as any).plugins?.plugins?.['fjg-task-manager'];
  if(plugin?.resolveOpenAiApiKey)return plugin.resolveOpenAiApiKey();
  try {const data=JSON.parse(await app.vault.adapter.read(`${app.vault.configDir}/plugins/fjg-task-manager/data.json`));return typeof data.openAiApiKey==='string'?data.openAiApiKey:'';}catch{return '';}
}
export class CaptureVoice {
  private session?: CaptureLiveSession;
  private closed=false;
  private muted=false;
  private status: HTMLElement;
  private log: HTMLElement;
  private startButton: HTMLButtonElement;
  private muteButton: HTMLButtonElement;
  private endButton: HTMLButtonElement;
  private audio: HTMLAudioElement;
  constructor(root: HTMLElement, private app: App, private label: string, private port: CapturePort, private key: ()=>Promise<string>) {
    const panel=root.createDiv({cls:'fjg-capture-live'});
    panel.createEl('p',{text:'Talk to fill this capture, make corrections, then say “Save it.” Audio and capture fields go to OpenAI while connected.'});
    const controls=panel.createDiv({cls:'fjg-capture-live-controls'});
    this.startButton=controls.createEl('button',{text:'Talk to capture',cls:'mod-cta'});this.startButton.onclick=()=>void this.start();
    this.muteButton=controls.createEl('button',{text:'Mute',attr:{'aria-pressed':'false'}});this.muteButton.disabled=true;
    this.muteButton.onclick=()=>{this.muted=!this.muted;this.session?.mute(this.muted);this.muteButton.textContent=this.muted?'Unmute':'Mute';this.muteButton.setAttribute('aria-pressed',String(this.muted));};
    this.endButton=controls.createEl('button',{text:'End voice'});this.endButton.disabled=true;this.endButton.onclick=()=>this.session?.end();
    this.status=panel.createEl('p',{text:'Ready for live capture',attr:{role:'status'}});
    this.audio=panel.createEl('audio',{attr:{controls:'',autoplay:'','aria-label':'Capture assistant playback'}});
    const details=panel.createEl('details');details.createEl('summary',{text:'Conversation'});this.log=details.createDiv({cls:'fjg-capture-live-transcript',attr:{role:'log'}});
  }
  get active(): boolean { return !this.closed && !!this.session?.active; }
  async start(): Promise<void> {
    if(this.closed||this.startButton.disabled||!this.port.ready())return;
    this.startButton.disabled=true;this.session?.dispose();this.muted=false;this.muteButton.textContent='Mute';this.muteButton.setAttribute('aria-pressed','false');
    const tools=new CaptureTools(this.port,()=>this.active);
    this.session=new CaptureLiveSession(this.audio,{
      state:(state,message)=>{if(this.closed)return;this.status.textContent=message;this.startButton.disabled=['connecting','connected','ending'].includes(state);this.muteButton.disabled=state!=='connected';this.endButton.disabled=!['connecting','connected'].includes(state);},
      transcript:(speaker,delta)=>{if(this.closed)return;let line=this.log.lastElementChild as HTMLElement|null;if(!line||line.dataset.speaker!==speaker){line=this.log.createEl('p',{text:`${speaker}: `});line.dataset.speaker=speaker;}line.appendText(delta);while(this.log.children.length>60)this.log.firstElementChild?.remove();},
      execute:(name,args)=>tools.execute(name,args)
    });
    try { const key=await this.key();if(this.closed)return;await this.session.start(key,'gpt-5.6-terra',JSON.stringify({capture:this.label,date:new Date().toLocaleDateString('en-CA'),time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone})); }
    catch {this.session.dispose();this.status.textContent='Could not start live capture. Check your saved OpenAI key.';this.startButton.disabled=false;}
  }
  close(): void {this.closed=true;this.session?.end();}
}
