---
description: Search FJG Task Manager tasks, projects, due dates, notes, and update history
allowed-tools: Bash
argument-hint: [task or project question]
---

Query the live FJG Task Manager data for this question:

$ARGUMENTS

Run the read-only helper below, passing the question as one correctly shell-quoted argument:

`node ".claude/task-manager/query.cjs" "$ARGUMENTS"`

Use only the JSON returned by the helper as evidence. Do not infer task facts that are absent from it and do not modify any task files. If `no_results` is true, say that no matching Task Manager data was found and suggest a narrower task title, project, status, due-date, or update-history query. If the helper reports an error, explain the reported recovery step without inventing an answer.

For answers with results:

- Summarize the answer directly, including relevant status, due date, project, notes, and update history.
- For weekly project status, distinguish overdue work, work due this week, and work updated this week using the returned week boundaries.
- Point back to the returned vault paths with Obsidian wiki links such as `[[path/to/task|Task title]]` and `[[path/to/updates|Updates]]` whenever the path is non-empty.
- Mention when a task has more update history than the returned excerpt (`update_count` is greater than the number of `updates`).
