# Migration Guide

1. Obtain a protected, read-only Taskboard JSON export.
2. Run the migration tool without `--apply`.
3. Review counts, skipped records, field mappings, warnings, legacy tags, task destinations, and project destinations.
4. Run with `--apply` into a staging directory outside the active workspace root.
5. Run the migration audit against the source export and staging directory.
6. Validate with `taskctl validate`.
7. Review representative active, completed, cancelled, delegated, due-date, duplicate-title, missing-date, project, and update-history tasks.
8. Test the plugin and dashboard against staged data.
9. At cutover, pause legacy writes, take a final export, and repeat the dry run, apply, audit, and validation in a new dated staging directory.

The importer:

- Preserves safe stable IDs.
- Uses readable task-title folders with deterministic numeric suffixes when titles collide.
- Maps Cancelled to Archived and records the legacy status.
- Imports only the approved `task` tag by default.
- Records other legacy tags in the manifest for review.
- Uses the explicit `1970-01-01T00:00:00.000Z` sentinel when the source has no creation date.
- Creates project workspaces for managed projects and project names referenced by tasks but absent from the managed project list.
- Skips deleted tasks.
- Never modifies the source export or legacy system.

After applying into staging:

```bash
node tools/migration/dist/audit.cjs \
  --input "/path/to/taskboard-export.json" \
  --staging "/path/to/staging"
```

The audit verifies every semantic task record, complete update history, attachments folder, and project record. It tolerates the standard `title`, `location`, and empty `tags` properties that Obsidian may add automatically without changing the migrated task data.
