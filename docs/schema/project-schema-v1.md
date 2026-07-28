# Project Schema Version 1

Dashboard-created projects are stored as synchronized vault workspaces:

```text
08 Tasks/Projects/
└── Project Name/
    └── project.md
```

Required `project.md` properties:

```yaml
schema_version: 1
type: fjg-task-project
name: Project Name
created_at: 2026-07-28T08:00:00.000Z
updated_at: 2026-07-28T08:00:00.000Z
```

Projects intentionally do not receive an automatic tag. Tasks continue to reference a project by its exact readable name. The project workspace keeps an empty project visible in the dashboard, Quick Capture, AI drafting, and the Chrome clipper before any task is assigned to it.
