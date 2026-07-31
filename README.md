# FJG Task Manager

Folder-based task workspaces for Obsidian with a native dashboard, live update cards, voice/text quick capture, AI drafting, Chrome clipping, safe agent updates, archive moves, and migration tooling.

## Architecture

- `apps/obsidian-plugin` — native Obsidian plugin and dashboard
- `apps/browser-clipper` — Chrome Manifest V3 extension
- `packages/task-core` — task schema, Markdown, IDs, statuses, paths, updates
- `packages/task-protocol` — browser protocol v3 and v2 compatibility
- `tools/taskctl` — vault-relative task CLI for Codex and agents
- `tools/migration` — dry-run-first Taskboard JSON importer

Markdown task workspaces are authoritative. The dashboard and Chrome search catalog are derived.

Live workspace folders use the readable task title. The stable `task_id` remains inside `task.md` and is hidden from ordinary dashboard and folder-title views. Duplicate titles receive a numeric folder suffix such as `(2)`.

## Dashboard navigation

The dashboard keeps **Do First** as the opening view and adds two clear sections:

- **Tasks** — switch among Do First, Do Soon, Waiting, Delegated, Inbox, On Hold, Due or Overdue, All Open, Unassigned, and Archived without leaving the dashboard. Inbox contains tasks explicitly assigned the Inbox status; Unassigned is a separate validation view for task files whose source status is missing or unrecognized.
- **Projects** — scan every active project by open and total task counts, search the project list, archive finished projects, and switch to Archived Projects when older work is needed.

Tasks without a project appear in a separate **No project** group. The Archived task view reads workspaces from the configured task archive root and provides **Reopen to Do First**.

Select **New Project** on the Projects screen to create a project before it has tasks. Project definitions are stored as synchronized vault workspaces at `08 Tasks/Projects/<Project Name>/project.md`; they remain visible with zero tasks and become immediately selectable in Quick Capture and the Chrome clipper.

When a registered project has zero open tasks, its card offers **Archive**. After confirmation, all completed tasks in that project move to `08 Tasks/Archive/` and the project workspace moves to `08 Tasks/Project Archive/`. Nothing is deleted. **Archived Projects** lists the finished project and provides **Reopen**; reopening returns only the project definition to the active list, while its tasks remain archived until explicitly reopened.

Each task row shows its two newest task updates. The dashboard's Recent Updates section identifies the associated task on every update card, and selecting a card opens that task. The cards refresh after an update is saved and when Obsidian reports a task-file change; **View all** opens the task's complete `updates.md` log.

Each task also includes a compact **Related files** section. Markdown notes show excerpts, images show thumbnails, and other supporting files show their type, size, and task-relative location. **Add file** can create a new working note or import existing files into `attachments/`; **Copy path** copies the absolute task-folder path on desktop or the vault-relative path on mobile; **Open folder** reveals the workspace in Obsidian's file explorer.

## Quick capture

Use **FJG Task Manager: Quick Capture Task**, the circle-plus ribbon icon, or **Capture Task** on the dashboard.

1. Type a rough task description or select **Dictate** and record it.
2. Select **Draft Tasks**, or let drafting run automatically after transcription.
3. Review each distinct action as its own editable task card. Remove any draft you do not want.
4. Select **Create Task** or **Create N Tasks**.

AI drafting can return up to 20 task cards from one capture. It never creates a task automatically, never merges independent actions, and leaves due dates blank unless timing was explicitly stated. The user always reviews the structured fields first. Status remains a property, and `task` remains the only automatic tag.

The Advanced URI command is:

```text
obsidian://advanced-uri?vault=FJG%20Vault&commandid=fjg-task-manager%3Aquick-capture
```

An iOS Shortcut can also URL-encode dictated text and open:

```text
obsidian://fjg-task-manager?text=<URL-encoded dictated text>
```

Configure the OpenAI key, drafting model, transcription model, and automatic drafting behavior in FJG Task Manager settings.

## Build and test

```bash
npm install
npm run check
```

## Install the Obsidian plugin

```bash
npm run install:vault -- --vault "/path/to/your/vault"
```

Enable **FJG Task Manager** in Obsidian Community Plugins, then use **Open Task Dashboard** or **Quick Capture Task**.

## Load the Chrome extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select `apps/browser-clipper/dist`.
5. Open the extension Settings.
6. Copy the pairing token from Obsidian's FJG Task Manager settings and test the connection.

The Chrome task catalog is loopback-only and read-only. All writes continue through `obsidian://fjg-task-clipper`.

## Task CLI

```bash
node tools/taskctl/dist/taskctl.cjs list --vault "/path/to/vault"
node tools/taskctl/dist/taskctl.cjs update --vault "/path/to/vault" --id tsk_... --actor Codex --text "Update text"
node tools/taskctl/dist/taskctl.cjs status --vault "/path/to/vault" --id tsk_... --to completed --actor Codex
node tools/taskctl/dist/taskctl.cjs validate --vault "/path/to/vault"
```

## Migration

Always begin with a dry run:

```bash
node tools/migration/dist/migrate.cjs \
  --input /path/to/tasks.json \
  --output /path/to/staging
```

Review `migration-manifest.json`, then repeat with `--apply`. The importer never connects to or modifies the legacy Taskboard.

After applying into an isolated staging directory, reconcile every task, update history, attachments folder, and project workspace:

```bash
node tools/migration/dist/audit.cjs \
  --input /path/to/tasks.json \
  --staging /path/to/staging
```

The importer uses readable task-title folders, adds quiet numeric suffixes for duplicate titles, imports only the approved `task` tag, uses an explicit unknown-date sentinel when the source creation date is missing, and stages both managed and task-referenced project workspaces.

## Release

```bash
npm run check
npm run package:release
```

The existing Taskboard, iOS app, Taskboard clipper, Obsidian clipper, and bridge remain legacy references until Franklin approves cutover.
