---
name: task-manager
description: Query the live FJG Task Manager index for grounded answers about tasks and project status, including titles, notes, projects, statuses, due dates, delegation, and update history. Use for natural-language task searches, weekly project-status questions, overdue or due-date questions, waiting or delegated work, and requests to find or summarize Task Manager content in the FJG Vault.
---

# Task Manager

Run the authenticated read-only query helper with the user's complete question as one correctly shell-quoted argument:

```bash
node ".agents/skills/task-manager/scripts/query.cjs" "<question>"
```

Treat the returned JSON as the only evidence for the answer. Do not infer missing task facts, scan unrelated vault files as a fallback, or modify task data.

- If `no_results` is true, state that no matching Task Manager data was found. Suggest a narrower title, project, status, due-date, or update-history query.
- If the helper reports an error, explain its recovery step and stop without inventing an answer.
- For weekly project status, distinguish overdue work, work due in the returned week, and work updated in that week.
- Include relevant status, due date, project, notes, and update history.
- Link non-empty returned paths with Obsidian wiki links: `[[path/to/task|Task title]]`, `[[path/to/updates|Updates]]`, and `[[path/to/project|Project]]`.
- If `update_count` exceeds the returned `updates` length, say that additional history exists in the linked update note.
