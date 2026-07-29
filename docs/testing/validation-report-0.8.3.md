# FJG Task Manager v0.8.3 Validation

Date: 2026-07-29

## Scope

Validated compact per-task Recent Updates cards without redundant task-name
rows.

## Automated validation

- TypeScript type checking passed.
- Thirteen test files passed.
- Fifty-eight tests passed.
- Production builds succeeded for the Obsidian plugin, Chrome clipper, task
  CLI, and migration tool.
- Release packaging completed with BRAT-compatible root files and both ZIP
  artifacts.

## Live Obsidian validation

- Installed FJG Task Manager v0.8.3 into the canonical FJG Vault and reloaded
  Obsidian.
- Opened `Manage Leyla's Out of Class arrangements` in the Do First view.
- Confirmed the task name appears once in the parent task header.
- Confirmed both Recent Updates cards begin with `Jul 29, 2026 · Franklin`
  rather than repeating the task title.
- Confirmed both full update messages remain visible.
- Confirmed the cards retain their full clickable area and accessible task
  label.

## Result

Pass. FJG Task Manager v0.8.3 removes redundant task-name rows while preserving
the context and function of per-task Recent Updates.
