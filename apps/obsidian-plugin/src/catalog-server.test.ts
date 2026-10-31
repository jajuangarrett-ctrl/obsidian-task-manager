import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {ObjectiveSelection} from "./objective-selection";
import * as http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogTask } from "@fjg/task-protocol";
import { loadHttp, TaskCatalogServer } from "./catalog-server";

const task: CatalogTask = {
  task_id: "01JTESTCATALOG000000000000",
  title: "Prepare catalog security review",
  status: "do-first",
  project: "Task Manager",
  delegated_to: "",
  path: "08 Tasks/Workspaces/01JTESTCATALOG000000000000 - Prepare catalog security review/task.md",
  archived: false
};

describe("TaskCatalogServer", () => {
  const servers: TaskCatalogServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.stop()));
    servers.length = 0;
    vi.unstubAllGlobals();
  });

  async function start(): Promise<{ server: TaskCatalogServer; url: string }> {
    const server = new TaskCatalogServer();
    servers.push(server);
    await server.start({
      port: 0,
      token: "test-secret",
      getTasks: () => [task],
      getProjects: () => ["Empty Project", "Task Manager"],
      getPeople: () => ["Sam Lee", "Alex Rivera", "Alex Rivera"],
      queryTasks: (question) => ({
        ok: true,
        mode: "search",
        question,
        generated_at: "2026-08-12T12:00:00.000Z",
        count: question === "missing" ? 0 : 1,
        no_results: question === "missing",
        message: question === "missing" ? "No Task Manager tasks matched." : "Found one task.",
        projects: [],
        tasks: []
      })
    });
    return { server, url: `http://127.0.0.1:${server.getPort()}` };
  }

  it("requires a token and exposes only authenticated read routes", async () => {
    const { url } = await start();

    const unauthorized = await fetch(`${url}/health`);
    expect(unauthorized.status).toBe(401);

    const health = await fetch(`${url}/health`, {
      headers: { Authorization: "Bearer test-secret" }
    });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: "fjg-task-catalog" });

    const result = await fetch(`${url}/tasks?q=security`, {
      headers: { "X-FJG-Task-Token": "test-secret" }
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ count: 1, tasks: [{ task_id: task.task_id }] });

    const query = await fetch(`${url}/query?q=project%20status`, {
      headers: { Authorization: "Bearer test-secret" }
    });
    expect(query.status).toBe(200);
    expect(await query.json()).toMatchObject({ ok: true, question: "project status", no_results: false });

    const emptyQuery = await fetch(`${url}/query`, {
      headers: { Authorization: "Bearer test-secret" }
    });
    expect(emptyQuery.status).toBe(400);
    expect(await emptyQuery.json()).toEqual({ error: "Provide a task or project question in q." });

    const writeAttempt = await fetch(`${url}/tasks`, {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" }
    });
    expect(writeAttempt.status).toBe(405);
  });

  it("rejects ordinary web origins while allowing extension origins", async () => {
    const { url } = await start();

    const webOrigin = await fetch(`${url}/projects`, {
      headers: {
        Authorization: "Bearer test-secret",
        Origin: "https://example.com"
      }
    });
    expect(webOrigin.status).toBe(403);

    const extensionOrigin = await fetch(`${url}/projects`, {
      headers: {
        Authorization: "Bearer test-secret",
        Origin: "chrome-extension://abcdefghijklmnop"
      }
    });
    expect(extensionOrigin.status).toBe(200);
    expect(extensionOrigin.headers.get("access-control-allow-origin")).toBe("chrome-extension://abcdefghijklmnop");
    expect(await extensionOrigin.json()).toEqual({ projects: ["Empty Project", "Task Manager"] });
  });

  it("serves people only through the authenticated, read-only extension catalog", async () => {
    const { url } = await start();
    expect((await fetch(`${url}/people`)).status).toBe(401);
    expect((await fetch(`${url}/people`, {headers: {Authorization: "Bearer test-secret", Origin: "https://example.com"}})).status).toBe(403);
    const response = await fetch(`${url}/people`, {headers: {Authorization: "Bearer test-secret", Origin: "chrome-extension://abcdefghijklmnop"}});
    expect(await response.json()).toEqual({people: ["Alex Rivera", "Sam Lee"]});
    expect((await fetch(`${url}/people`, {method: "POST", headers: {Authorization: "Bearer test-secret"}})).status).toBe(405);
  });

  it("uses Electron's require function when it is available", async () => {
    const runtimeRequire = vi.fn(() => http);
    vi.stubGlobal("require", runtimeRequire);

    expect(await loadHttp()).toBe(http);
    expect(runtimeRequire).toHaveBeenCalledWith("node:http");
  });
});

it("existing Claudian helper retrieves the live checked selection through authenticated GET without mutation",async()=>{
 const server=new TaskCatalogServer(),selection=new ObjectiveSelection();
 const dir=await mkdtemp(join(tmpdir(),'fjg-selection-'));
 try{
  await server.start({port:0,token:'selection-test',getTasks:()=>[],getSelection:()=>selection.context([])});
  const url=`http://127.0.0.1:${server.getPort()}`;
  await mkdir(join(dir,'.obsidian/plugins/fjg-task-manager'),{recursive:true});
  await writeFile(join(dir,'.obsidian/plugins/fjg-task-manager/data.json'),JSON.stringify({catalogPort:server.getPort(),catalogToken:'selection-test'}));
  const query=async()=>JSON.parse((await promisify(execFile)(process.execPath,[resolve('integrations/claudian/query.cjs'),'checked objectives'],{cwd:dir})).stdout);
  expect(await query()).toMatchObject({mode:'checked-objectives',count:0});
  for(let i=0;i<55;i++)selection.set(`id-${i}`,'completed',true);
  expect(await query()).toMatchObject({count:55,available_count:0});
  selection.clear();expect(await query()).toMatchObject({count:0,no_results:true});
  expect((await fetch(url+'/selection')).status).toBe(401);
  const headers={Authorization:'Bearer selection-test'};
  expect((await fetch(url+'/selection',{headers:{...headers,Origin:'https://example.com'}})).status).toBe(403);
  expect((await fetch(url+'/selection',{headers,method:'POST'})).status).toBe(405);
  const response=await fetch(url+'/selection',{headers});expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toMatchObject({count:0});
 }finally{await server.stop();await rm(dir,{recursive:true,force:true});}
});

it('serves authenticated deletion receipts but refuses mutation methods',async()=>{
 const server=new TaskCatalogServer(),batch='00000000-0000-0000-0000-000000000000';
 await server.start({port:0,token:'fixture',getTasks:()=>[],getDeleteReceipt:id=>id===batch?{mode:'deletion-receipt',state:'completed'}:undefined});
 try {
  const url=`http://127.0.0.1:${server.getPort()}/query?q=${encodeURIComponent('deletion receipt '+batch)}`;
  expect((await fetch(url)).status).toBe(401);
  const options={headers:{Authorization:'Bearer fixture'}};
  expect(await (await fetch(url,options)).json()).toMatchObject({mode:'deletion-receipt',state:'completed'});
  expect((await fetch(url,{...options,method:'POST'})).status).toBe(405);
 }finally{await server.stop();}
});
