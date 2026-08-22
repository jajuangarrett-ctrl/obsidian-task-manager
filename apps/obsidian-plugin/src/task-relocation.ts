import { normalizeVaultPath } from "@fjg/task-core";

export const TASK_RELOCATION_ROOTS = ["02 Programs", "03 Areas"] as const;

export function normalizeTaskRelocationDestination(value: string): string {
  const path = normalizeVaultPath(value);
  if (!TASK_RELOCATION_ROOTS.some((root) => path.startsWith(`${root}/`))) {
    throw new Error("Choose a folder inside 02 Programs or 03 Areas.");
  }
  return path;
}

export function isTaskRelocationDestination(value: string): boolean {
  try {
    normalizeTaskRelocationDestination(value);
    return true;
  } catch {
    return false;
  }
}

export function isTaskRelocationPath(value: string): boolean {
  try {
    const path = normalizeVaultPath(value);
    return TASK_RELOCATION_ROOTS.some((root) => path.startsWith(`${root}/`))
      && path.toLocaleLowerCase().endsWith("/task.md");
  } catch {
    return false;
  }
}

export function isTaskRelocationBundlePath(value: string): boolean {
  if (!isTaskRelocationPath(value)) return false;
  return !/\/Tasks\/[^/]+\/task\.md$/i.test(normalizeVaultPath(value));
}

export function filterTaskRelocationDestinations(paths: readonly string[]): string[] {
  const destinations = new Map<string, string>();
  for (const value of paths) {
    let path: string;
    try {
      path = normalizeTaskRelocationDestination(value);
    } catch {
      continue;
    }
    const root = TASK_RELOCATION_ROOTS.find((candidate) => path.startsWith(`${candidate}/`));
    if (!root) continue;
    const relativeSegments = path.slice(root.length + 1).split("/");
    if (relativeSegments.some((segment) => segment.startsWith("."))) continue;
    destinations.set(path.toLocaleLowerCase(), path);
  }
  return [...destinations.values()].sort((left, right) => left.localeCompare(right));
}
