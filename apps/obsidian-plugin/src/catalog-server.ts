import type { CatalogTask } from "@fjg/task-protocol";

type HttpModule = typeof import("node:http");
type HttpServer = import("node:http").Server;
type IncomingMessage = import("node:http").IncomingMessage;
type ServerResponse = import("node:http").ServerResponse;

export class TaskCatalogServer {
  private server: HttpServer | null = null;
  private readonly requests = new Map<string, number[]>();

  async start(options: {
    port: number;
    token: string;
    getTasks: () => CatalogTask[];
  }): Promise<void> {
    await this.stop();
    const http = await loadHttp();
    this.server = http.createServer((request, response) => {
      this.handle(request, response, options).catch((error) => {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      });
    });
    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) return reject(new Error("Task catalog server was not created."));
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(options.port, "127.0.0.1");
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  isRunning(): boolean {
    return this.server?.listening === true;
  }

  getPort(): number | null {
    const address = this.server?.address();
    return address && typeof address === "object" ? address.port : null;
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
    options: { token: string; getTasks: () => CatalogTask[] }
  ): Promise<void> {
    const origin = String(request.headers.origin || "");
    if (origin && !isAllowedExtensionOrigin(origin)) return sendJson(response, 403, { error: "Origin is not allowed." });
    setCors(response, origin);
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (!this.withinRateLimit(request.socket.remoteAddress || "local")) return sendJson(response, 429, { error: "Too many requests." });
    if (!isAuthorized(request, options.token)) return sendJson(response, 401, { error: "Task catalog token is invalid." });
    if (request.method !== "GET") return sendJson(response, 405, { error: "Task catalog is read-only." });

    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/health") {
      return sendJson(response, 200, { ok: true, service: "fjg-task-catalog", version: 1 });
    }
    if (url.pathname === "/projects") {
      const projects = [...new Set(options.getTasks().map((task) => task.project).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
      return sendJson(response, 200, { projects });
    }
    if (url.pathname === "/tasks") {
      const query = normalizeSearch(url.searchParams.get("q") || "");
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 20, 50));
      const tokens = query.split(" ").filter(Boolean);
      const tasks = options.getTasks()
        .map((task) => {
          const haystack = normalizeSearch([
            task.task_id,
            task.title,
            task.status,
            task.project,
            task.delegated_to,
            task.path
          ].join(" "));
          const matches = tokens.every((token) => haystack.includes(token));
          const exact = normalizeSearch(task.task_id) === query || normalizeSearch(task.title) === query;
          return { task, matches, exact };
        })
        .filter((entry) => entry.matches)
        .sort((left, right) => Number(right.exact) - Number(left.exact) || left.task.title.localeCompare(right.task.title))
        .slice(0, limit)
        .map((entry) => entry.task);
      return sendJson(response, 200, { tasks, count: tasks.length });
    }
    return sendJson(response, 404, { error: "Unknown task catalog route." });
  }

  private withinRateLimit(key: string): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;
    const recent = (this.requests.get(key) || []).filter((time) => time >= windowStart);
    if (recent.length >= 120) return false;
    recent.push(now);
    this.requests.set(key, recent);
    return true;
  }
}

export async function loadHttp(): Promise<HttpModule> {
  const runtimeRequire = (globalThis as typeof globalThis & { require?: NodeRequire }).require;
  if (typeof runtimeRequire === "function") return runtimeRequire("node:http") as HttpModule;
  return import("node:http");
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  const authorization = String(request.headers.authorization || "");
  const headerToken = String(request.headers["x-fjg-task-token"] || "");
  return authorization === `Bearer ${token}` || headerToken === token;
}

function isAllowedExtensionOrigin(origin: string): boolean {
  return /^chrome-extension:\/\/[a-z]+$/i.test(origin) || /^moz-extension:\/\//i.test(origin);
}

function setCors(response: ServerResponse, origin: string): void {
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, X-FJG-Task-Token, Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}
