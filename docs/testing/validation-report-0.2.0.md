# Validation Report — 0.2.0

Date: 2026-07-27

## Scope

This release expands the native Obsidian dashboard while keeping the existing folder-based task schema, Chrome protocol, archive behavior, and Do First default unchanged.

## Automated validation

- TypeScript validation completed successfully.
- All 28 unit and integration tests passed.
- Dashboard tests cover open/completed/archived separation, due-date rules, every canonical active status, project summaries, and no-project filtering.
- Production builds completed for the Obsidian plugin, Chrome clipper, CLI, and migration tool.
- Release packaging produced the Obsidian and Chrome archives.

## Live Obsidian validation

- The installed plugin loaded successfully from the vault runtime folder.
- The dashboard opened to Do First.
- Tasks and Projects tabs switched without opening another view.
- The project overview rendered named projects separately from the No project group.
- Project search filtered the visible project cards.
- Selecting a project opened its All Open task view.
- Task-view counts were scoped to the selected project.
- Status labels, status accents, task controls, and project navigation rendered correctly in the current desktop theme.
- Installed runtime files matched the release build.

## Still requiring manual acceptance

- Create, update, complete, archive, reopen, and open representative non-production tasks through the new dashboard.
- Verify the responsive layout in Obsidian Mobile on Franklin's devices.
- Verify the BRAT update on Franklin's other Mac.
- Review and approve the existing protected 238-task staging migration before any live cutover.
