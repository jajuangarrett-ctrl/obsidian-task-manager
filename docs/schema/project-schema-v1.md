# Legacy Project Schema Version 1

This schema is retained only so existing project folders remain readable. New
project membership is task-based: each assigned task has one nested tag such as
`project/Basic_Needs_Expansion`, with the readable `project` property kept in
sync. The Projects dashboard is derived from task tags across the vault and no
longer creates, renames, archives, or reopens project folders.

Dashboard-created projects are stored as synchronized vault workspaces:

```text
08 Tasks/Projects/
└── Project Name/
    └── project.md

08 Tasks/Project Archive/
└── Project Name/
    └── project.md
```

Required `project.md` properties:

```yaml
schema_version: 1
type: fjg-task-project
name: Project Name
status: active
created_at: 2026-07-28T08:00:00.000Z
updated_at: 2026-07-28T08:00:00.000Z
archived_at: ""
```

Legacy project notes do not create a dashboard project by themselves. A project
appears when at least one active task carries its project tag.

`status` is either `active` or `archived`. `archived_at` is empty for active projects and contains the archive timestamp for archived projects. Files created before these fields were introduced remain valid and are interpreted as active.

Archiving moves the entire project folder to the configured project archive root. Reopening moves it back to the active project root and clears `archived_at`. The Markdown body below the frontmatter is preserved through both transitions.
