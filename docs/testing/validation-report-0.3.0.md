# Validation Report — 0.3.0

Date: July 27, 2026

## Result

The Quick Capture, AI drafting, recent-update display, manual refresh, and Chrome title-generation fixes are ready for private release.

## Automated validation

- `npm run typecheck` passed.
- `npm test` passed with 37 tests across nine files.
- Production builds passed for the Obsidian plugin, Chrome extension, task CLI, and migration tool.
- Strict task-draft request construction, Responses API parsing, local status/project/date constraints, update-log parsing, and Chrome Responses parsing have dedicated tests.

## Live API validation

An active OpenAI credential was selected from Franklin's designated credential note without printing or logging the secret. The key passed the models endpoint and returned HTTP 200 from a real `gpt-4.1-mini` Responses request using the plugin's strict task-draft schema.

The credential was used in memory only for this validation. Persistent plugin storage remains a separate approval step.

## Installed Obsidian validation

- The exact build was installed to `.obsidian/plugins/fjg-task-manager/`.
- The plugin loaded after a full Obsidian reload without an FJG Task Manager console error.
- The Waiting view rendered the two newest saved updates for “Quote for RM 116.”
- The Refresh action rebuilt the dashboard and preserved the current update cards.
- View all was available for opening the complete update log.
- The dashboard Capture Task action opened the new modal.
- The modal rendered Capture, Dictate, Draft Task, title, Do First default status, project, due date, More details, and Create Task controls.

## Visual review

The rendered update cards and Quick Capture modal were compared in one review input with Franklin's iOS Taskboard update and capture screenshots. The Obsidian implementation keeps the same hierarchy—capture first, AI drafting second, reviewable structured fields, and update cards directly below the task—while using the existing Obsidian theme and dashboard spacing.

Current-run screenshots are stored in the vault UX audit folder as:

- `09-Obsidian-Task-Updates-v0.3.0.jpeg`
- `10-Obsidian-Quick-Capture-v0.3.0.jpeg`

## Remaining device acceptance

- Confirm microphone permission and transcription on Franklin's primary Mac.
- Confirm microphone permission, responsive layout, and task creation on Obsidian Mobile.
- Install and run the Advanced URI and dictated-text iOS Shortcuts.
- Reload the packaged Chrome extension and confirm Generate Title with the configured Chrome-local OpenAI key.
