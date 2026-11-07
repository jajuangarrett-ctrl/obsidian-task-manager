import { describe, expect, it, vi } from "vitest";
import { revealInFileFocus } from "./file-focus-integration";

describe("Objective Manager Show in file", () => {
  const path = "03 Areas/Example/Files";
  const registry = (plugins: Record<string,unknown>) => ({getPlugin: (id:string) => plugins[id]});

  it("works with only Duo enabled", async () => {
    const revealFolderPath = vi.fn();
    expect(await revealInFileFocus(registry({"fjg-file-focus-duo":{revealFolderPath}}),async()=>path,true)).toBe("FJG File Focus Duo");
    expect(revealFolderPath).toHaveBeenCalledExactlyOnceWith(path);
  });
  it("preserves original-only support", async () => {
    const revealFolderPath = vi.fn();
    expect(await revealInFileFocus(registry({"fjg-file-focus":{revealFolderPath}}),async()=>path,true)).toBe("FJG File Focus");
    expect(revealFolderPath).toHaveBeenCalledExactlyOnceWith(path);
  });
  it("uses Duo when both are enabled", async () => {
    const duo=vi.fn(), original=vi.fn(), folder=vi.fn(async()=>path);
    expect(await revealInFileFocus(registry({"fjg-file-focus-duo":{revealFolderPath:duo},"fjg-file-focus":{revealFolderPath:original}}),folder,true)).toBe("FJG File Focus Duo");
    expect(duo).toHaveBeenCalledExactlyOnceWith(path);expect(original).not.toHaveBeenCalled();expect(folder).toHaveBeenCalledOnce();
  });
  it("skips an incompatible Duo and falls back to the original", async () => {
    const revealFolderPath=vi.fn();
    expect(await revealInFileFocus(registry({"fjg-file-focus-duo":{revealFolderPath:true},"fjg-file-focus":{revealFolderPath}}),async()=>path,true)).toBe("FJG File Focus");
  });
  it("does not create folders when neither navigator is available", async () => {
    const folder=vi.fn(async()=>path);
    expect(await revealInFileFocus(registry({}),folder,true)).toBeNull();
    expect(await revealInFileFocus(undefined,folder,true)).toBeNull();expect(folder).not.toHaveBeenCalled();
  });
  it("keeps the original navigator on desktop when both are enabled", async () => {
    const duo=vi.fn(), original=vi.fn();
    expect(await revealInFileFocus(registry({"fjg-file-focus-duo":{revealFolderPath:duo},"fjg-file-focus":{revealFolderPath:original}}),async()=>path,false)).toBe("FJG File Focus");
    expect(original).toHaveBeenCalledExactlyOnceWith(path);expect(duo).not.toHaveBeenCalled();
  });
  it("does not switch desktop to Duo when the original is disabled", async () => {
    const duo=vi.fn(), folder=vi.fn(async()=>path);
    expect(await revealInFileFocus(registry({"fjg-file-focus-duo":{revealFolderPath:duo}}),folder,false)).toBeNull();
    expect(duo).not.toHaveBeenCalled();expect(folder).not.toHaveBeenCalled();
  });
  it("preserves the method's receiver", async () => {
    const plugin={lastPath:"",revealFolderPath(p:string){this.lastPath=p;}};
    await revealInFileFocus(registry({"fjg-file-focus-duo":plugin}),async()=>path,true);expect(plugin.lastPath).toBe(path);
  });
  it("propagates reveal errors for the caller's notice without opening another navigator", async () => {
    const original=vi.fn();
    await expect(revealInFileFocus(registry({"fjg-file-focus-duo":{revealFolderPath:async()=>{throw new Error("Folder not found");}},"fjg-file-focus":{revealFolderPath:original}}),async()=>path,true)).rejects.toThrow("Folder not found");
    expect(original).not.toHaveBeenCalled();
  });
});
