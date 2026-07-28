# Task Schema Version 1

Required `task.md` properties:

```yaml
schema_version: 1
task_id: tsk_01...
title: Review budget packet
status: do-first
priority: normal
due:
created_at: 2026-07-27T16:00:00.000Z
updated_at: 2026-07-27T16:00:00.000Z
completed_at:
archived_at:
project:
delegated_to:
source_type: manual
source_title:
source_url:
legacy_ids: []
legacy_status:
tags:
  - task
```

Canonical statuses:

- `inbox`
- `do-first`
- `do-soon`
- `delegate`
- `waiting`
- `on-hold`
- `completed`
- `archived`

`task` is the sole default tag. Status tags are forbidden.

The stable `task_id` is internal metadata and is not part of the live workspace folder title. Live folders use the sanitized task title, with a numeric suffix such as `(2)` only when needed to avoid a collision.
