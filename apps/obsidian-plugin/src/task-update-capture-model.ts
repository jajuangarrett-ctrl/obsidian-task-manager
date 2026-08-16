import type { CatalogTask } from "@fjg/task-protocol";

function normalize(value: string): string {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function filterTaskUpdateOptions(
  tasks: readonly CatalogTask[],
  query: string,
  limit = 20
): CatalogTask[] {
  const clean = normalize(query);
  const tokens = clean.split(" ").filter(Boolean);
  return tasks
    .map((task) => {
      const haystack = normalize([
        task.task_id,
        task.title,
        task.status,
        task.project,
        task.delegated_to,
        task.path
      ].join(" "));
      const matches = tokens.every((token) => haystack.includes(token));
      const exact = normalize(task.task_id) === clean || normalize(task.title) === clean;
      return { task, matches, exact };
    })
    .filter(({ matches }) => matches)
    .sort((left, right) =>
      Number(right.exact) - Number(left.exact)
      || Number(left.task.archived) - Number(right.task.archived)
      || left.task.title.localeCompare(right.task.title)
    )
    .slice(0, Math.max(1, Math.min(limit, 50)))
    .map(({ task }) => task);
}
