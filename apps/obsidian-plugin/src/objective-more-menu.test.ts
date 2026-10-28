import {it,expect,vi} from "vitest";
import {renderObjectiveMoreMenu} from "./objective-more-menu";
class Element {
 children:Element[]=[];listeners:Record<string,()=>void>={};open=false;
 constructor(public tag='',public options:{text?:string;attr?:Record<string,string>}={}){}
 createEl(tag:string,options={}){const child=new Element(tag,options);this.children.push(child);return child;}
 createDiv(options={}){return this.createEl('div',options);}
 addEventListener(event:string,fn:()=>void){this.listeners[event]=fn;}
}
it.each(['desktop','touch'])('Completed cards expose a native More menu with Move and Delete on %s',()=>{
 const root=new Element(),actions={rename:vi.fn(),move:vi.fn(),addFile:vi.fn(),convert:vi.fn(),remove:vi.fn()};
 const menu=renderObjectiveMoreMenu(root as unknown as HTMLElement,'Completed fixture',actions) as unknown as Element;
 expect(menu.tag).toBe('details');expect(menu.children[0].tag).toBe('summary');expect(menu.children[0].options.text).toBe('More');
 const buttons=menu.children[1].children;expect(buttons.map(b=>b.options.text)).toEqual(['Rename','Move folder','Add file','Convert to action','Delete…']);
 menu.open=true;buttons.find(b=>b.options.text==='Move folder')!.listeners.click();expect(actions.move).toHaveBeenCalledOnce();expect(menu.open).toBe(false);
 buttons.find(b=>b.options.text==='Delete…')!.listeners.click();expect(actions.remove).toHaveBeenCalledOnce();expect(actions.rename).not.toHaveBeenCalled();
});
it('keeps Complete for open cards without duplicating commands',()=>{const root=new Element();renderObjectiveMoreMenu(root as unknown as HTMLElement,'Open',{rename:()=>{},move:()=>{},addFile:()=>{},convert:()=>{},remove:()=>{},complete:()=>{}});const labels=root.children[0].children[1].children.map(b=>b.options.text);expect(labels).toContain('Complete');expect(new Set(labels).size).toBe(labels.length);});
