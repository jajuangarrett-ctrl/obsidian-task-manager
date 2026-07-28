# FJG Task Manager

Folder-based task workspaces for Obsidian with a native dashboard, Chrome clipping, safe agent updates, archive moves, and migration tooling.

## Architecture

- `apps/obsidian-plugin` — native Obsidian plugin and dashboard
- `apps/browser-clipper` — Chrome Manifest V3 extension
- `packages/task-core` — task schema, Markdown, IDs, statuses, paths, updates
- `packages/task-protocol` — browser protocol v3 and v2 compatibility
- `tools/taskctl` — vault-relative task CLI for Codex and agents
- `tools/migration` — dry-run-first Taskboard JSON importer

Markdown task workspaces are authoritative. The dashboard and Chrome search catalog are derived.

## Dashboard navigation

The dashboard keeps **Do First** as the opening view and adds two clear sections:

- **Tasks** — switch among Do First, Do Soon, Waiting, Delegated, Inbox, On Hold, Due or Overdue, All Open, and Completed without leaving the dashboard.
- **Projects** — scan every named project by open and total task counts, search the project list, and select a project to open its scoped task views.

Tasks without a project appear in a separate **No project** group. Archived work remains outside the active dashboard because archiving physically moves its workspace to the configured archive root.

## Build and test

```bash
npm install
npm run check
```

## Install the Obsidian plugin

```bash
npm run install:vault -- --vault "/path/to/your/vault"
```

Enable **FJG Task Manager** in Obsidian Community Plugins, then use **Open Task Dashboard**.

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

## Release

```bash
npm run check
npm run package:release
```

The existing Taskboard, iOS app, Taskboard clipper, Obsidian clipper, and bridge remain legacy references until Franklin approves cutover.
