# FJG Task Manager v0.8.4 Validation

Date: 2026-07-30

## Scope

Validated restoration of the Inbox task view and separation of Inbox from
Unassigned.

## Automated validation

- TypeScript type checking passed.
- Thirteen test files passed.
- Sixty tests passed.
- Production builds succeeded for the Obsidian plugin, Chrome clipper, task
  CLI, and migration tool.
- Release packaging completed with BRAT-compatible root files and both ZIP
  artifacts.

## Behavioral validation

- Confirmed recognized source statuses remain assigned.
- Confirmed missing and unrecognized source statuses are tracked separately
  even though the canonical record safely normalizes them to Inbox.
- Confirmed an explicitly assigned Inbox task matches Inbox and not
  Unassigned.
- Confirmed an unrecognized source-status task matches Unassigned and not
  Inbox.

## Live Obsidian validation

- Installed FJG Task Manager v0.8.4 into the canonical FJG Vault and reloaded
  the plugin.
- Confirmed the task-view grid shows Inbox, Unassigned, and Archived while
  Completed remains absent.
- Confirmed Inbox reports the current explicit Inbox tasks.
- Confirmed Unassigned reports no current malformed or missing-status task
  files.

## Result

Pass. FJG Task Manager v0.8.4 restores Inbox and gives Unassigned a distinct,
non-duplicative validation purpose.
