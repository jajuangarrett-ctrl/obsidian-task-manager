# ADR-002: Markdown Source of Truth

Status: Accepted
Date: 2026-07-27
Updated: 2026-08-23

## Decision

Each active project or Inbox workspace contains three matching task-specific
artifact directories:

```text
Tasks/<Task Title>/task.md
Updates/<Task Title>/updates.md
Files/<Task Title>/
```

All three directories are created eagerly when the task is created. Markdown
files are authoritative; the dashboard and task catalog are derived indexes.
Active project tasks live under `08 Tasks/Projects/<Project Name>/`, tasks with
no project live under `08 Tasks/Inbox/`, and archived tasks move to
`08 Tasks/Archive/`.

## Consequences

- Tasks remain readable without the plugin.
- Stable task IDs are required because folder titles and locations can change.
- Copying a task Files path always yields an existing directory.
- Archive and reopen operations must preserve links and roll back on failure.
