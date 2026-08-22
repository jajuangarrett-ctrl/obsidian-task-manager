# FJG Task Manager

Project-centered task workspaces for Obsidian with a native dashboard, live update cards, voice/text quick capture, AI drafting, Gmail intake, Chrome clipping, safe agent updates, archive moves, and migration tooling.

## Architecture

- `apps/obsidian-plugin` — native Obsidian plugin and dashboard
- `apps/browser-clipper` — Chrome Manifest V3 extension
- `packages/task-core` — task schema, Markdown, IDs, statuses, paths, updates
- `packages/task-protocol` — browser protocol v3 and v2 compatibility
- `tools/taskctl` — vault-relative task CLI for Codex and agents
- `tools/migration` — dry-run-first Taskboard JSON importer

Markdown task files are authoritative. The dashboard and Chrome search catalog are derived.

## Storage layout

Tasks now live inside a project workspace instead of creating one folder per
task. A project uses this synchronized layout:

```text
08 Tasks/Projects/<Project Name>/
  project.md
  Tasks/<Task Title>.md
  Updates/<Task Title>.md
  Files/
```

Tasks without a project use the same layout under `08 Tasks/Inbox/`. Assigning
or changing a project from the dashboard physically moves both the task note
and its update log into the selected project's workspace. Choosing **No
project** moves them back to Inbox. The stable `task_id` remains in task
frontmatter and never appears in filenames.

Files are shared project resources. Inbox files added through the dashboard or
Gmail intake receive a task-title prefix so only the owning Inbox task displays
them. **Copy path** copies the vault-relative `Files/` destination for Obsidian Web Clipper. Existing
per-task workspaces under `08 Tasks/Workspaces/` remain readable during a
migration but are no longer used for new tasks.

## Gmail task intake

The `FJG Task Manager` Google Apps Script saves matching messages into
`AI Team/Mira Emails/`. When a new email subject begins with `[Inbox]`,
`[Do First]`, `[Do Soon]`, `[Delegate]`, `[Waiting]`, or `[On Hold]`, the saved
note includes versioned intake metadata. FJG Task Manager detects that note,
creates a normal task with the matching status, writes the stable task ID and
final file path into the email note, and moves that original Markdown email
into the task's project or Inbox `Files/` folder.

Only marked notes are imported. Existing historical email files and new emails
without a supported status prefix remain ordinary notes. The email is moved,
not copied, so no second active copy remains in `AI Team/Mira Emails/`. Gmail message IDs are
used to create deterministic task and request IDs, making the import repeat-safe
across plugin reloads and synchronization. Intake is enabled by default and its
vault-relative folder can be changed in FJG Task Manager settings. If the task
or attachment move cannot finish, the original email remains in the intake
folder and is retried safely.

Live task notes use the readable task title. The stable `task_id` remains inside the note and is hidden from ordinary dashboard and file-title views. Duplicate titles receive a numeric suffix such as `(2)`.

## Dashboard navigation

The dashboard keeps **Do First** as the opening view and adds two clear sections:

- **Tasks** — switch among Recent Tasks, Do First, Do Soon, Ongoing, Waiting, Delegated, Inbox, On Hold, Due or Overdue, All Open, and Archived without leaving the dashboard.
- **Projects** — scan every active project by open and total task counts, search the project list, archive finished projects, and switch to Archived Projects when older work is needed.

Tasks without a project appear in a separate **No project** group and are physically stored in Inbox. The Archived task view reads task notes from the configured archive root and provides **Reopen to Do First**.

Select **New Project** on the Projects screen to create a project before it has tasks. Project definitions are stored as synchronized vault workspaces at `08 Tasks/Projects/<Project Name>/project.md`; they remain visible with zero tasks and become immediately selectable in Quick Capture and the Chrome clipper.

When a registered project has zero open tasks, its card offers **Archive**. After confirmation, all completed tasks in that project move to `08 Tasks/Archive/` and the project workspace moves to `08 Tasks/Project Archive/`. Nothing is deleted. **Archived Projects** lists the finished project and provides **Reopen**; reopening returns only the project definition to the active list, while its tasks remain archived until explicitly reopened.

Each active task row includes an inline due-date action beside its project, update, and archive controls. It shows the current `YYYY-MM-DD` value or **Add due date**, then opens a native date picker where the date can be saved or cleared. The task note and update history are refreshed immediately after the change.

Each task row shows its two newest task updates without redundantly repeating the task title inside the parent task card. The cards refresh after an update is saved and when Obsidian reports a task-file change; **View all** opens the task's complete update log.

Each task also includes a compact **Related files** section backed by the project or Inbox `Files/` area. Markdown notes show excerpts, images show thumbnails, and other supporting files show their type, size, and workspace-relative location. **Add file** can create a new working note or import existing files; **Copy path** copies the portable vault-relative `Files/` path used by Obsidian Web Clipper; **Open folder** reveals the shared workspace in Obsidian.

Use **Move folder** on an active task to relocate its complete task workspace into an existing subfolder of `02 Programs/` or `03 Areas/`. The task note, update history, task-owned files, stable ID, status, project assignment, and file references stay together, and the relocated task remains available in the dashboard. Shared files referenced by another task stay at their original path so the other relationship is not broken.

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

## Review-first task updates

An integration can open a prefilled update review without writing to the vault:

```text
obsidian://fjg-task-update?text=<URL-encoded update text>
```

The native modal searches the live task catalog and requires the user to select one exact task before **Add Update** is enabled. Opening the link, searching, or selecting a task does not write an update; only the final button appends to the selected stable task ID.

## Ask Claudian about tasks

Task Manager generates `Task Manager Briefing.md` inside the configured active workspace root. The note is rebuilt from the authoritative Task Manager index whenever the dashboard refreshes. It contains every active and archived dashboard task, registered projects (including projects without tasks), task details and notes, status, due date, delegation, recent update history, and links back to the task, project, and full update notes.

Click **Open Task Briefing** in the dashboard (or run **FJG Task Manager: Open Task Briefing**) to regenerate and open the note directly in Obsidian. Then ask Claudian a natural-language question such as “What is the status of my projects this week?” while the briefing note is open. The dashboard's **Refresh** button also regenerates the briefing.

If Task Manager has no indexed data, the briefing states that no tasks or projects are available. If the note cannot be written or opened, Task Manager shows an error notice instead of opening an empty or invented result.

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

After applying into an isolated staging directory, reconcile every task, update history, supporting-file area, and project workspace:

```bash
node tools/migration/dist/audit.cjs \
  --input /path/to/tasks.json \
  --staging /path/to/staging
```

The importer uses readable task-title files, adds quiet numeric suffixes for duplicate titles, imports only the approved `task` tag, uses an explicit unknown-date sentinel when the source creation date is missing, and stages both managed and task-referenced project workspaces.

## Release

```bash
npm run check
npm run package:release
```

The prior Taskboard, iOS app, Taskboard clipper, Obsidian-focused clipper, and bridge remain legacy references. FJG Task Manager is the active Obsidian task workflow.
