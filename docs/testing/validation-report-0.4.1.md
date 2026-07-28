# FJG Task Manager v0.4.1 Validation

Date: 2026-07-27

## Scope

Validated the task-workspace document layer added in v0.4.0 and the deterministic folder-browser correction in v0.4.1.

## Automated validation

- TypeScript validation passed.
- All 42 tests across 10 test files passed.
- Production builds passed for the Obsidian plugin, Chrome clipper, `taskctl`, and migration tool.
- Release packaging completed for both the Obsidian plugin and Chrome extension.
- Installed plugin runtime checksums matched the source build for `main.js`, `manifest.json`, and `styles.css`.

## Interface validation

Validated the installed build in Obsidian 1.12.7:

- The dashboard rendered **Related files**, **Add file**, and **Open folder** under the live task card.
- **Add file → New note** rendered title, starting-notes, and create-and-open controls.
- **Add file → Attach files** rendered a multi-file picker with a disabled submit state until files are selected.
- **Open folder** rendered the task-folder browser over the dashboard.
- The folder browser listed `task.md` as the canonical task record and `updates.md` as the complete chronological update log.
- No test notes or attachments were created in live task data.

## Result

Pass. The installed v0.4.1 runtime is ready for desktop use and BRAT synchronization.
