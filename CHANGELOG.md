# Changelog

## 0.4.0 — 2026-07-27

### Added

- Add a Related files section to each dashboard task with compact previews for Markdown notes, image thumbnails, file type, size, and task-relative location.
- Add a polished Add file flow with separate options to create and open a new task note or import one or more existing supporting files.
- Store imported files inside the task workspace's `attachments/` folder and keep new Markdown notes at the task workspace root.
- Add Open folder controls that use Obsidian's native file explorer when available and otherwise open a complete in-plugin task-folder browser for consistent desktop and mobile access.
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
