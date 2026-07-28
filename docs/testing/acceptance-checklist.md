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

- [x] Confirm the dashboard opens to Do First.
- [x] Switch among the nine task views and confirm counts follow canonical status and due-date rules.
- [x] Search and filter active tasks by project.
- [x] Review the Projects overview and open a project-scoped All Open view.
- [x] Confirm project cards distinguish open counts from total non-archived counts.
- [x] Confirm the two newest task updates render below the task and View all opens `updates.md`.
- [x] Confirm manual Refresh reloads recent update cards.
- [ ] Create, update, complete, archive, and open tasks.
- [ ] Test desktop and Obsidian Mobile.

## Quick Capture

- [x] Open Quick Capture from the dashboard and confirm the touch-friendly review form renders.
- [x] Validate strict AI task drafting with an active key without exposing the credential.
- [x] Confirm AI-selected status, project, and due date are constrained by local validation.
- [x] Confirm the capture command and custom protocol handlers are registered.
- [ ] Confirm microphone permission and speech transcription on Obsidian Desktop.
- [ ] Confirm microphone permission and speech transcription on Obsidian Mobile.
- [ ] Install and run both iOS Shortcut variants on Franklin's iPhone.

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

See [Validation Report — 0.3.0](validation-report-0.3.0.md) for the latest reproducible validation record and remaining manual acceptance.
