# FJG Task Manager v0.8.3 Validation

Date: 2026-07-29

## Scope

Validated compact per-task Recent Updates cards without redundant task-name
rows and the replacement of Completed/Inbox dashboard tiles with one
Unassigned view.

## Automated validation

- TypeScript type checking passed.
- Thirteen test files passed.
- Fifty-nine tests passed.
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
- Confirmed the task-view grid contains Unassigned and Archived but no
  Completed or duplicate Inbox tile.
- Confirmed Unassigned reports three tasks and selecting it renders all three
  current Inbox/default-status task workspaces.

## Result

Pass. FJG Task Manager v0.8.3 removes redundant task-name rows while preserving
the context and function of per-task Recent Updates, and it provides one
Unassigned view for tasks that still need a workflow status.
