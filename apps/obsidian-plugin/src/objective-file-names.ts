import { sanitizeTitleForPath } from "@fjg/task-core";

type Role = "Task" | "Updates";
const suffixRole = (role: Role) => role === "Task" ? "Objective" : role;

export function objectiveFileName(title: string, role: Role): string {
  return `${sanitizeTitleForPath(title)} - ${suffixRole(role)}.md`;
}

export function isObjectiveFileName(name: string, role: Role): boolean {
  return name.toLowerCase() === `${role.toLowerCase()}.md` || namedStem(name, role) !== null;
}

export function namedStem(name: string, role: Role): string | null {
  const suffix = ` - ${suffixRole(role)}.md`;
  return name.length > suffix.length && name.toLowerCase().endsWith(suffix.toLowerCase())
    ? name.slice(0, -suffix.length) : null;
}

/** The task filename is the pairing key. Keep a fallback for mixed-version sync. */
export function updateNamesForTask(taskFileName: string, flat: boolean): string[] {
  const stem = namedStem(taskFileName, "Task");
  if (!stem) return [flat ? taskFileName : "updates.md"];
  return [`${stem} - Updates.md`, flat ? `${stem}.md` : "updates.md"];
}

export function taskArtifactPathParts(path: string): RegExpMatchArray | null {
  const parts = path.match(/^(.*)\/Tasks\/([^/]+)\/([^/]+)$/);
  return parts && isObjectiveFileName(parts[3], "Task") ? parts : null;
}
