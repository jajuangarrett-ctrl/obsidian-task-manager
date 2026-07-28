# FJG Task Manager v0.6.0 Validation

Date: 2026-07-28

## Scope

Validated archived task visibility, safe task reopening, guarded project archiving, archived project navigation, project reopening, backward-compatible project metadata, packaged runtime installation, and live dashboard rendering.

## Automated validation

- TypeScript type checking passed.
- Eleven test files passed.
- Forty-nine tests passed.
- Production builds succeeded for the Obsidian plugin, Chrome clipper, task CLI, and migration tool.
- Release packaging succeeded for the Obsidian plugin and Chrome clipper.
- Project parsing tests confirmed that pre-v0.6.0 project files load as active.
- Project lifecycle tests confirmed that the Markdown body survives archive and reopen transitions.
- Dashboard tests confirmed archived-task counts and the zero-open-task archive gate.

## Live Obsidian validation

- Installed FJG Task Manager v0.6.0 into the canonical FJG Vault.
- Restarted Obsidian and confirmed the plugin loaded without a plugin-load failure.
- Confirmed the Tasks screen includes **Archived** and correctly reports the one existing archived task.
- Opened Archived and confirmed the archived task renders with **Reopen to Do First**, its update history, and its task-folder access.
- Confirmed archived tasks do not expose active mutation controls for status, update, archive, or adding files.
- Confirmed the Projects screen includes separate **Active Projects** and **Archived Projects** lists.
- Confirmed the live Archived Projects list renders its empty state and does not show New Project in the archived scope.
- Confirmed `08 Tasks/Project Archive` was created as a synchronized vault root.
- Did not create, archive, reopen, delete, or otherwise alter any live task or project during visual validation.

## Result

Pass. FJG Task Manager v0.6.0 is ready for non-destructive completed-task and project lifecycle management.
