# Changelog

## 0.8.3 — 2026-07-29

### Changed

- Remove the repeated task title and list icon from each task's own Recent
  Updates cards.
- Keep only the update date, actor, and update text in the per-task preview,
  since the parent task header already supplies the task context.
- Preserve the full-card click target and its accessible task label.
- Replace the Completed dashboard view with Unassigned, which collects tasks
  whose missing or unrecognized source status was normalized to Inbox.
- Remove the separate Inbox view so Unassigned is the single, non-duplicative
  place for tasks that still need a workflow status.

### Validation

- Confirm both updates for `Manage Leyla's Out of Class arrangements` render
  without repeated task-name rows.
- Confirm the date, actor, and complete update text remain visible and the
  update cards remain clickable.
- Confirm Unassigned lists the three current Inbox/default-status tasks and
  that Completed and Inbox no longer appear as task-view tiles.
- Pass all automated tests, TypeScript validation, and production builds.

## 0.8.2 — 2026-07-28

### Fixed

- Let Recent Updates cards grow to their natural content height instead of
  allowing the date and update text to spill beneath the task workspace card.
- Keep update titles, metadata, and multiline update text contained inside the
  clickable update surface.
- Preserve clean separation between a task with updates and the task card that
  follows it.

### Validation

- Reproduce the issue with `Immediate CalWORKs Termination of Work Study
  student` in the live Delegated view.
- Confirm the title, date, actor, and full status-change text remain inside the
  task card with the following Onboarding task visible below.
- Pass all automated tests, TypeScript validation, and production builds.

## 0.8.1 — 2026-07-28

### Fixed

- Let long task-title callouts grow to their natural wrapped height instead of
  clipping text or overlapping the status row.
- Slightly reduce task-title text size and line spacing for easier scanning.
- Top-align task actions with the title so long and short cards share a clean,
  consistent header.

### Validation

- Compare the requested furniture and A2MEND examples against the corrected
  live Obsidian dashboard.
- Confirm both titles remain inside their callout, status metadata stays below
  the title, and action controls remain aligned.
- Pass all automated tests, TypeScript validation, and production builds.

## 0.8.0 — 2026-07-28

### Added

- Add **Copy path** between **Add file** and **Open folder** on every task card.
- Copy the task workspace's absolute system folder path on desktop and its
  vault-relative folder path on mobile.
- Add **FJG Task Manager: Copy Task Folder Path** for an active task note or
  related task document.

### Validation

- Add macOS, Windows, trailing-separator, and mobile path tests.
- Confirm the live dashboard renders **Copy path** in the requested Related
  files action row.
- Confirm the screenshot task copies its complete absolute folder path.

## 0.7.0 — 2026-07-28

### Added

- Draft up to 20 distinct tasks from one typed or dictated capture.
- Show every AI draft as a separate editable review card with its own title,
  status, project, due date, details, delegation, and remove action.
- Create all approved drafts together with rollback protection if any workspace
  write fails.
- Show the associated task title on every Recent Updates card and open that task
  when the card is selected.

### Fixed

- Prevent AI drafting from merging independent actions into one task.
- Keep the due date empty unless the capture explicitly states a date, deadline,
  or relative time.

### Validation

- Pass all 54 automated tests, TypeScript validation, and production builds.
- Confirm the exact two-action CalWORKs/BSSP capture produces two review cards
  with empty due dates and creates no task before approval.
- Confirm Recent Updates cards display their task title and navigate to the
  corresponding `task.md`.

### Migration safety

- Stage legacy tasks in readable title-based folders with deterministic numeric suffixes instead of exposing internal IDs.
- Stage project workspaces for both the managed project list and project names referenced only by tasks.
- Use an explicit unknown-date sentinel for missing creation dates and keep excluded legacy tags visible in the manifest.
- Add a source-to-staging audit that verifies every task record, complete update history, attachments folder, and project record.
- Share the project workspace contract between the plugin and migration tool so staged projects use the same lifecycle schema as live projects.

## 0.6.1 — 2026-07-28

### Fixed

- Recover an OpenAI key saved in the older Task Capture plugin when FJG Task
  Manager has no key of its own.
- Reload the current plugin's saved credential before reporting that the key is
  missing, which protects mobile capture from stale in-memory settings.
- Add a mobile-friendly **Save & Test** action that persists the value visible
  in the password field before testing it.

### Validation

- Add settings-migration coverage and pass all 53 automated tests, TypeScript
  validation, and production builds.

## 0.6.0 — 2026-07-28

### Added

- Add an **Archived** task view that lists task workspaces from the task archive and provides **Reopen to Do First**.
- Add Active Projects and Archived Projects lists without adding another top-level dashboard section.
- Add a guarded **Archive Project** action only for registered projects with zero open tasks.
- Move a finished project's completed tasks to `08 Tasks/Archive/` and its project workspace to `08 Tasks/Project Archive/` after explicit confirmation.
- Add **Reopen** for archived projects while intentionally leaving their tasks archived for separate review.
- Add a configurable project archive root and synchronized project lifecycle properties.

### Safety

- Project archiving is rejected by the workspace service whenever an open task remains, even if invoked outside the dashboard.
- Project and task files are moved, never deleted; updates, related documents, attachments, and project notes remain intact.
- Existing project files without lifecycle properties continue to load as active projects.

### Validation

- Add archive-view, project-eligibility, legacy-project, body-preservation, archive-transition, and reopen-transition tests.

## 0.5.0 — 2026-07-28

### Added

- Add a touch-friendly **New Project** action directly to the dashboard Projects screen.
- Persist projects as synchronized vault workspaces under `08 Tasks/Projects/<Project Name>/project.md`.
- Keep newly created projects visible with zero tasks and make them immediately available in dashboard filters, Quick Capture, AI drafting, and the Chrome clipper.
- Add the **FJG Task Manager: Create Project** command and a configurable project-workspace root.

### Validation

- Add project-definition parsing tests and verify that registered empty projects remain visible in project summaries.

## 0.4.1 — 2026-07-27

### Fixed

- Make **Open folder** use the plugin's deterministic task-folder browser on every device.
- Avoid false-success navigation when a customized Obsidian sidebar intercepts the standard file-explorer view.
- Keep the dashboard visible behind the folder browser and provide direct access to `task.md`, `updates.md`, attachments, and all related documents.

### Validation

- Reloaded the installed plugin in Obsidian and visually confirmed the final folder browser on the live dashboard without creating or changing task data.

## 0.4.0 — 2026-07-27

### Added

- Add a Related files section to each dashboard task with compact previews for Markdown notes, image thumbnails, file type, size, and task-relative location.
- Add a polished Add file flow with separate options to create and open a new task note or import one or more existing supporting files.
- Store imported files inside the task workspace's `attachments/` folder and keep new Markdown notes at the task workspace root.
- Add Open folder controls that open a complete in-plugin task-folder browser for consistent desktop and mobile access, including vaults that replace Obsidian's standard file explorer.
- Add active-task commands for Add File to Task Workspace and Open Task Folder.
- Add collision-safe related-file naming so existing files are never overwritten.

### Validation

- Add focused tests for related-file classification, Markdown preview cleanup, file sizes, reserved workspace documents, and safe filenames.

## 0.3.1 — 2026-07-27

### Changed

- Hide internal task IDs from dashboard task cards.
- Name live task workspace folders from the readable task title instead of prefixing the title with `tsk_…`.
- Preserve `task_id` in `task.md` as the stable internal identity for linking, browser updates, CLI operations, and duplicate-title handling.
- Add unobtrusive numeric folder suffixes such as `(2)` only when two tasks have the same sanitized title.
- Normalize existing live and archived workspace folder names when the updated plugin loads.
- Keep the protected legacy migration staging layout unchanged until Franklin approves a new cutover review.

## 0.3.0 — 2026-07-27

### Added

- Add a touch-friendly Quick Capture modal modeled on the iOS Taskboard capture flow.
- Add typed capture, in-plugin microphone recording, OpenAI speech-to-text, and structured AI task drafting.
- Populate reviewable title, details, status, project, due date, and optional delegation fields before creation.
- Add a Quick Capture command, circle-plus ribbon action, dashboard Capture Task action, Advanced URI command, and prefilled custom URI.
- Add plugin settings for the OpenAI API key, task drafting model, transcription model, automatic drafting after dictation, and a safe connection test.
- Show the two newest non-creation updates directly below every task, with a View all link to the complete update log.
- Add update-log parsing and automatic dashboard refresh support for update-file changes.
- Add current-run visual validation against the iOS capture and update references.

### Fixed

- Fix Chrome Generate Title by parsing the nested text shape returned by the OpenAI Responses REST API.
- Make task-root initialization resilient when the vault folders exist on disk before Obsidian's file cache is fully ready.
- Make the dashboard Refresh action visibly reload recent task updates.

### Validation

- 37 automated tests pass across nine test files.
- TypeScript validation and all production builds pass.
- A live API smoke test returned a valid strict structured task draft.
- The installed plugin loads without FJG Task Manager console errors and renders both update cards and the Quick Capture modal.

## 0.2.0 — 2026-07-27

### Added

- Add a simple Tasks/Projects dashboard switcher modeled on the iOS Taskboard's separation between working views and project organization.
- Add navigable task views for Do First, Do Soon, Waiting, Delegated, Inbox, On Hold, Due or Overdue, All Open, and Completed.
- Add a searchable project overview with per-project open and total task counts.
- Add project drill-down that opens the project's All Open view and scopes every view count to that project.
- Add an explicit No project group so unassigned work remains visible without becoming a named project.
- Add status labels, status accents, accessible control labels, keyboard focus styling, and responsive layouts.
- Add unit tests for dashboard view rules, due-date behavior, project filtering, and project summaries.

## 0.1.1 — 2026-07-27

### Fixed

- Load the desktop catalog through Electron's Node runtime while retaining the test-environment fallback.
- Persist normalized first-run settings and the Chrome pairing token immediately.
- Log catalog startup failures to the developer console for actionable diagnostics.

## 0.1.0 — 2026-07-27

Initial private-use release of the folder-based FJG Task Manager system.

### Included

- Native Obsidian dashboard with Do First as the default view.
- Folder-based task workspaces with stable IDs, canonical YAML, append-only updates, and physical archive moves.
- Chrome Manifest V3 clipper for Create Task and Add Update from highlighted text.
- Authenticated, loopback-only, read-only desktop catalog with live task search.
- Protocol v3 with compatibility normalization for legacy v2 requests.
- Configurable `taskctl` CLI for safe agent and Codex operations.
- Dry-run-first, repeat-safe legacy Taskboard migration tooling.
- BRAT-compatible root plugin files and packaged Obsidian and Chrome release archives.
