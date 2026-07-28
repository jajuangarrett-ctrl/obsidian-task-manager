# Validation Report — 0.1.0

Date: 2026-07-27

## Passed

- TypeScript validation for the entire monorepo.
- Sixteen automated tests across Task Core, Task Protocol, Chrome capture, catalog security, and migration.
- Production builds for the Obsidian plugin, Chrome extension, `taskctl`, and migration tool.
- Catalog authentication, extension-origin restriction, read-only method enforcement, search, and project-list behavior.
- Protocol v3 encode/decode, malformed input rejection, and legacy v2 compatibility.
- Default `task` tag enforcement and status-tag removal.
- Task path sanitization and stable-ID handling.
- Migration dry run, staged apply, and repeat apply against legacy fixtures.
- Cancelled-to-archived mapping and legacy metadata retention.
- CLI validation, update append, completion, physical archive move, physical reopen move, and post-transition validation.
- Installed vault runtime byte comparison against the production plugin build.
- JavaScript syntax validation for the installed plugin.
- Obsidian and Chrome ZIP archive integrity.
- Production dependency audit with zero known vulnerabilities.

## Manual acceptance still required

- Reload Obsidian and confirm the FJG Task Manager dashboard opens to Do First.
- Exercise create, update, complete, archive, reopen, and search from the native dashboard.
- Load the Chrome release, pair it with the desktop token, and test Create Task and Add Update.
- Test ordinary webpages, Gmail, Outlook, duplicate titles, catalog-off fallback, and oversized capture fallback.
- Confirm desktop and Obsidian Mobile layout.
- Export protected live Taskboard JSON and review a staged migration before any cutover.
- Verify Obsidian Sync behavior on a second device.

The installed plugin and legacy systems coexist. No live legacy tasks were imported, and no legacy launcher or integration was changed.
