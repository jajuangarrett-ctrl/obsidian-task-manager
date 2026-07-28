import type { CatalogTask } from "@fjg/task-protocol";
import type { ClipperSettings } from "./storage";

export async function searchCatalog(
  settings: Pick<ClipperSettings, "catalogPort" | "catalogToken">,
  query: string,
  signal?: AbortSignal
): Promise<CatalogTask[]> {
  if (!settings.catalogToken) throw new Error("Add the Obsidian pairing token in Settings.");
  const url = new URL(`http://127.0.0.1:${settings.catalogPort}/tasks`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "20");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${settings.catalogToken}` },
    signal,
    cache: "no-store"
  });
  const body = await response.json() as { tasks?: CatalogTask[]; error?: string };
  if (!response.ok) throw new Error(body.error || `Catalog HTTP ${response.status}`);
  return Array.isArray(body.tasks) ? body.tasks : [];
}

export async function fetchProjects(
  settings: Pick<ClipperSettings, "catalogPort" | "catalogToken">
): Promise<string[]> {
  if (!settings.catalogToken) return [];
  const response = await fetch(`http://127.0.0.1:${settings.catalogPort}/projects`, {
    headers: { Authorization: `Bearer ${settings.catalogToken}` },
    cache: "no-store"
  });
  if (!response.ok) return [];
  const body = await response.json() as { projects?: string[] };
  return Array.isArray(body.projects) ? body.projects : [];
}

export async function testCatalog(
  settings: Pick<ClipperSettings, "catalogPort" | "catalogToken">
): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${settings.catalogPort}/health`, {
    headers: { Authorization: `Bearer ${settings.catalogToken}` },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
}
