# FJG Task Manager v0.7.0 Validation

Date: 2026-07-28

## Scope

Validated multi-task AI drafting from one capture, editable review-before-create
behavior, due-date restraint, guarded batch creation, Recent Updates task
attribution, direct update-to-task navigation, packaged runtime installation, and
live Obsidian rendering.

## Automated validation

- TypeScript type checking passed.
- Twelve test files passed.
- Fifty-four tests passed.
- Production builds succeeded for the Obsidian plugin, Chrome clipper, task CLI,
  and migration tool.
- The strict AI response schema requires a root task array containing between one
  and twenty complete task drafts.
- Parser tests confirm two independent actions remain two tasks and older
  single-task responses remain readable.
- Prompt tests prohibit invented due dates and require timing to be explicit.
- Batch workspace tests prevalidate writes and roll back newly planned workspaces
  if a later task creation fails.

## Live Obsidian validation

- Installed the development build into the canonical FJG Vault and reloaded
  FJG Task Manager successfully.
- Entered `Create plan for our CalWORKs intern, Create plan for BSSP intern.`
  and selected **Draft Tasks**.
- Confirmed the plugin displayed **New Tasks (2)** with separate editable cards
  for the CalWORKs and BSSP actions.
- Confirmed both draft due dates remained empty because the capture stated no
  timing.
- Closed the capture without selecting **Create 2 Tasks** and confirmed no test
  task workspace was created.
- Opened a task with recent updates and confirmed each update card displayed
  **Quote for RM 116** as its associated task.
- Selected a Recent Updates card and confirmed Obsidian opened the corresponding
  `task.md`.

## Result

Pass. FJG Task Manager v0.7.0 is ready for reviewed multi-task capture and
task-attributed Recent Updates.
