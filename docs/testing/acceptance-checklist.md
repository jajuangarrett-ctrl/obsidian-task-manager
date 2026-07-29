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
- [x] Switch among the ten task views and confirm counts follow canonical status and due-date rules.
- [x] Search and filter active tasks by project.
- [x] Review the Projects overview and open a project-scoped All Open view.
- [x] Confirm project cards distinguish open counts from total non-archived counts.
- [x] Confirm the two newest task updates render below the task and View all opens `updates.md`.
- [x] Confirm each Recent Updates card names its associated task and opens that task.
- [x] Confirm Copy path appears between Add file and Open folder on live task cards.
- [x] Confirm Copy path writes the complete desktop task-workspace path to the clipboard.
- [x] Confirm the path helper falls back to a vault-relative path on mobile.
- [x] Confirm multiline task titles stay inside an auto-height callout without overlapping status metadata.
- [x] Confirm long-title action controls remain top-aligned on the live desktop dashboard.
- [x] Confirm manual Refresh reloads recent update cards.
- [x] Confirm archived task workspaces appear in Archived and expose Reopen to Do First.
- [x] Confirm only registered projects with zero open tasks expose Archive Project.
- [x] Confirm Archived Projects lists archived project definitions and exposes Reopen.
- [ ] Create, update, complete, archive, and open tasks.
- [ ] Test desktop and Obsidian Mobile.

## Quick Capture

- [x] Open Quick Capture from the dashboard and confirm the touch-friendly review form renders.
- [x] Validate strict AI task drafting with an active key without exposing the credential.
- [x] Confirm AI-selected status, project, and due date are constrained by local validation.
- [x] Confirm one capture with two independent actions produces two editable task cards.
- [x] Confirm AI drafting leaves due dates blank when the capture states no timing.
- [x] Confirm multi-task drafting remains review-before-create and does not write test tasks.
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

See [Validation Report — 0.8.1](validation-report-0.8.1.md) for the latest reproducible validation record and remaining manual acceptance.
