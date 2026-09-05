# ADR-002: Markdown Source of Truth

Status: Accepted
Date: 2026-07-27
Updated: 2026-09-05

## Decision

Each Inbox workspace contains three matching task-specific artifact
directories:

```text
Tasks/<Task Title>/task.md
Updates/<Task Title>/updates.md
Files/<Task Title>/
```

All three directories are created eagerly when the task is created. Markdown
files are authoritative; the dashboard and task catalog are derived indexes.
New tasks live under `08 Tasks/Inbox/`, relocated tasks live in their chosen
`02 Programs/` or `03 Areas/` task collection, and archived tasks move to
`08 Tasks/Archive/`. Project membership is represented by a nested
`project/<Project_Name>` tag and never determines the storage path. The
readable `project` property is synchronized for display compatibility.

## Consequences

- Tasks remain readable without the plugin.
- Stable task IDs are required because folder titles and locations can change.
- Copying a task Files path always yields an existing directory.
- Changing a project tag must never move task files or rewrite their location.
- Archive and reopen operations must preserve links and roll back on failure.
