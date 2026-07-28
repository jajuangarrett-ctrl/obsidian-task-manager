# Acceptance Checklist

## Core and workspace

- [x] Create one task workspace with `task.md`, `updates.md`, and `attachments/` in test fixtures.
- [x] Confirm `task` is the only default tag.
- [x] Change active statuses and confirm audit entries in automated tests and CLI smoke testing.
- [x] Complete and reopen a staged task.
- [x] Archive a staged task and confirm its folder moves to `08 Tasks/Archive/`.
- [x] Reopen the staged archived task and confirm it returns to `08 Tasks/Workspaces/`.
- [ ] Confirm related Markdown links still work.

## Dashboard

- [ ] Confirm the dashboard opens to Do First.
- [ ] Search and filter by status and project.
- [ ] Create, update, complete, archive, and open tasks.
- [ ] Test desktop and Obsidian Mobile.

## Chrome

- [ ] Highlight text and create one task.
- [ ] Explicitly split selected lines and verify the preview count.
- [ ] Search tasks by title, ID, project, status, and delegated person.
- [ ] Distinguish duplicate titles and select one stable ID.
- [ ] Add highlighted text as an update with a source.
- [ ] Stop the catalog and verify recent-task/manual-ID fallback.
- [ ] Confirm oversized payloads are copied rather than truncated.

## Migration and Sync

- [x] Run a migration dry run and review its fixture manifest.
- [x] Re-run an applied fixture import without duplicate updates or data drift.
- [x] Compare fixture source and imported counts and stable IDs.
- [ ] Test Obsidian Sync on another Mac or mobile device.

See [Validation Report — 0.1.1](validation-report-0.1.1.md) for the latest reproducible validation record and remaining manual acceptance.
