# Migration Guide

1. Obtain a protected, read-only Taskboard JSON export.
2. Run the migration tool without `--apply`.
3. Review counts, skipped records, field mappings, warnings, legacy tags, and destinations.
4. Run with `--apply` into a staging directory outside the active workspace root.
5. Validate with `taskctl validate`.
6. Review representative active, completed, cancelled, delegated, due-date, and update-history tasks.
7. Test the plugin and dashboard against staged data.
8. At cutover, pause legacy writes, take a final export, and run an idempotent final import.

The importer:

- Preserves safe stable IDs.
- Maps Cancelled to Archived and records the legacy status.
- Imports only the approved `task` tag by default.
- Records other legacy tags in the manifest for review.
- Skips deleted tasks.
- Never modifies the source export or legacy system.
