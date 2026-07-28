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
      getProjects: () => ["Empty Project", "Task Manager"]
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

  it("uses Electron's require function when it is available", async () => {
    const runtimeRequire = vi.fn(() => http);
    vi.stubGlobal("require", runtimeRequire);

    expect(await loadHttp()).toBe(http);
    expect(runtimeRequire).toHaveBeenCalledWith("node:http");
  });
});
