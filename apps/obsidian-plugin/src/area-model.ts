import { TASK_RELOCATION_ROOTS } from "./task-relocation";
import type { IndexedTask } from "./workspace-service";

export const NO_AREA = "__no_area__";
export interface ObjectiveArea { path: string; name: string; label: string; count: number }

/** Folder paths are identities; labels and tags never determine membership. */
export function objectiveAreas(folderPaths: readonly string[], tasks: readonly IndexedTask[]): ObjectiveArea[] {
  const workspacePaths = new Set(tasks.map(task => task.taskFile.path.slice(0, task.taskFile.path.lastIndexOf("/"))));
  const areas = [...new Set(folderPaths)].filter(path => {
    if (!TASK_RELOCATION_ROOTS.some(root => path.startsWith(`${root}/`))) return false;
    const parts = path.split("/");
    return !parts.some(part => part.startsWith(".") || /^(files|subtasks|archive|archived)$/i.test(part))
      && !workspacePaths.has(path) && /^.+[\s_-]Tasks?$/i.test(parts.at(-1) || "");
  }).map(path => ({ path, name: path.split("/").at(-1)!, label: "", count: 0 }));
  for (const area of areas) {
    area.label = areas.filter(other => other.name.toLocaleLowerCase() === area.name.toLocaleLowerCase()).length > 1
      ? `${area.name} — ${area.path.slice(0, area.path.lastIndexOf("/"))}` : area.name;
  }
  for (const task of tasks) {
    if (task.archived || task.record.status === "archived") continue;
    const area = areas.find(area => area.path === objectiveAreaPath(task, areas));
    if (area) area.count++;
  }
  return areas.sort((a, b) => a.label.localeCompare(b.label));
}

/** Choose the closest collection, with slash boundaries to avoid sibling-prefix matches. */
export function objectiveAreaPath(task: IndexedTask, areas: readonly ObjectiveArea[]): string {
  return areas.filter(area => task.taskFile.path.startsWith(`${area.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]?.path || NO_AREA;
}

export function filterAreaObjectives(tasks: readonly IndexedTask[], areas: readonly ObjectiveArea[], selected: string, query: string): IndexedTask[] {
  const needle = query.trim().toLocaleLowerCase();
  return tasks.filter(task => !task.archived && task.record.status !== "archived"
    && (!selected || objectiveAreaPath(task, areas) === selected)
    && task.record.title.toLocaleLowerCase().includes(needle));
}
