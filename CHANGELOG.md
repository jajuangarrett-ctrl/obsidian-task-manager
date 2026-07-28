# Changelog

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
