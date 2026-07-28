# Project Schema Version 1

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

Projects intentionally do not receive an automatic tag. Tasks continue to reference a project by its exact readable name. The project workspace keeps an empty project visible in the dashboard, Quick Capture, AI drafting, and the Chrome clipper before any task is assigned to it.

`status` is either `active` or `archived`. `archived_at` is empty for active projects and contains the archive timestamp for archived projects. Files created before these fields were introduced remain valid and are interpreted as active.

Archiving moves the entire project folder to the configured project archive root. Reopening moves it back to the active project root and clears `archived_at`. The Markdown body below the frontmatter is preserved through both transitions.
