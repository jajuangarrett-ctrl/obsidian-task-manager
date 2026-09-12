# FJG Objective Manager

Objective workspaces with nested Actions for Obsidian, with a native dashboard, live update cards, voice/text quick capture, AI drafting, Gmail intake, Chrome clipping, safe agent updates, archive moves, and migration tooling.

## Objectives and Actions (0.16.0)

Main tasks are now labeled **Objectives**, and subtasks are **Actions**. The Projects dashboard section is removed; existing project tags remain available as metadata. **Capture action** opens the same fields as **Add action**, plus a searchable Objective picker. Choose an exact result before saving; editing the search clears that selection. Existing attachment controls, Copy path, conversion and promotion are unchanged.

This is not a vault migration: the plugin ID, `task_id`, `subtasks` metadata, command IDs, protocol routes, existing folder names, and `Task Manager Briefing.md` filename stay compatible. **Open objective briefing** refreshes the existing briefing with updated terminology. **Move folder** still moves the Objective's owned files and nested Action attachments; Copy path resolves the current destination. External Clipper templates containing an old literal path must be updated after a move. Older documentation below and external integrations may retain the original Task Manager terminology.

The repository also includes a macOS-native [Apple Mail capture integration](integrations/apple-mail-capture/README.md). Its Mail Quick Action saves one open or selected message, complete readable body, metadata, and attachments directly into any chosen existing FJG Vault folder, including Task Manager `Files` folders.

The Task Manager ribbon also provides **Capture task, agenda, or update**. Paste
or type source text once, choose the destination workflow, then review it in the
existing new-task, Agenda Capture, or exact-task update form before anything is
written. Agenda items require the separate Agenda Capture plugin to be enabled.

The system-wide **Capture to FJG Vault** macOS Shortcut opens the same review
screen from any app. Text received from a Quick Action is used first; otherwise
the Shortcut uses the existing clipboard. It places a one-time, URL-encoded
handoff marker on the clipboard and activates Obsidian. Task Manager consumes
that marker, restores the readable source text to the clipboard, and opens the
launcher. This avoids shell scripts and custom-URL stalls while keeping the
launcher available for manual editing or replacement text.
The plugin remains the only component that can create or update a task or agenda
item, and always requires review first.

### System-wide Mac capture

The installed Shortcut is available in the Services menu, Spotlight, and with
**Control-Option-Command-C**.

1. Select text in Mail, a browser, TextEdit, or another Mac app, then press the
   keyboard shortcut. If the app cannot supply selected text, copy the source
   first and press the shortcut.
2. Obsidian opens **Capture to FJG Vault** with the source text prefilled.
3. Choose **Create new task**, **Create agenda item**, or **Update existing
   task**, then select **Continue to Review**.
4. Review the normal destination form. The update path requires one exact task
   from Task Manager's authoritative catalog before **Add Update** is enabled.

Opening or cancelling any of these forms writes nothing. The macOS Shortcut uses
only native **Receive Input**, **Copy to Clipboard**, **URL Encode**, **Text**,
and **Open App** actions; it does not use Apple Mail automation, Automator, a
shell script, or Apple Intelligence.

## Architecture

- `apps/obsidian-plugin` — native Obsidian plugin and dashboard
- `apps/browser-clipper` — Chrome Manifest V3 extension
- `packages/task-core` — task schema, Markdown, IDs, statuses, paths, updates
- `packages/task-protocol` — browser protocol v3 and v2 compatibility
- `tools/taskctl` — vault-relative task CLI for Codex and agents
- `tools/migration` — dry-run-first Taskboard JSON importer

Markdown task files are authoritative. The dashboard and Chrome search catalog are derived.

## Storage layout

Tasks use a task-specific workspace in Inbox until they are explicitly moved
to a Program or Area folder:

```text
08 Tasks/Inbox/
  Tasks/<Task Title>/task.md
  Updates/<Task Title>/updates.md
  Files/<Task Title>/
```

Project membership is independent of storage. Assigning a project adds one
nested tag such as `project/Basic_Needs_Expansion` and keeps the readable
`project` property synchronized for dashboard labels and compatibility.
Changing or clearing the project tag never moves the task, update history, or
related files. Legacy folders under `08 Tasks/Projects/` remain untouched but
are no longer the source of the Projects list. The stable `task_id` remains in
task frontmatter and never appears in filenames.

Every new task immediately receives matching task, update, and Files directories.
Supporting files added through the dashboard, Gmail intake, Web Clipper, or an
external capture stay in that task-specific Files directory. **Copy path** ensures
the directory exists and copies its vault-relative destination. Existing
per-task workspaces under `08 Tasks/Workspaces/` remain readable during a
migration but are no longer used for new tasks.

## Gmail task intake

The `FJG Task Manager` Google Apps Script saves matching messages into
`AI Team/Mira Emails/`. When a new email subject begins with `[Inbox]`,
`[Do First]`, `[Do Soon]`, `[Delegate]`, `[Waiting]`, or `[On Hold]`, the saved
note includes versioned intake metadata. FJG Task Manager detects that note,
creates a normal task with the matching status, writes the stable task ID and
final file path into the email note, and moves that original Markdown email
into the task's current `Files/` folder.

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
- **Projects** — scan project tags across every Program and Area folder by open and total task counts, then open one tag to see its tasks together.

Tasks without a project appear in a separate **No project** group. A new
project tag is created from the project picker on a task; it does not create a
folder. Existing task files with a readable `project` property are backfilled
with the matching nested tag during plugin startup without changing their
paths. The Archived task view reads task notes from the configured archive root
and provides **Reopen to Do First**.

Each active task row includes an inline due-date action beside its project, update, and archive controls. It shows the current `YYYY-MM-DD` value or **Add due date**, then opens a native date picker where the date can be saved or cleared. The task note and update history are refreshed immediately after the change.

Use **Rename** on a task row to change the task name and its storage paths together. Standard workspaces rename the matching `Tasks`, `Updates`, and `Files` task folders; relocated workspaces rename the complete task bundle. The plugin rejects unsafe or colliding names, updates title, location, heading, and related-file metadata, and restores the original folders and task record if any step fails.

Changing a task's project updates only its project tag and readable project
label. The complete workspace stays exactly where it is, including tasks that
have already been moved into `02 Programs/` or `03 Areas/`. The task note and
update history are restored together if a metadata write fails.

Each task row shows its two newest task updates without redundantly repeating the task title inside the parent task card. The cards refresh after an update is saved and when Obsidian reports a task-file change; **View all** opens the task's complete update log.

Each task also includes a compact **Related files** section backed by its task-specific `Files/` directory. Markdown notes show excerpts, images show thumbnails, and other supporting files show their type, size, and workspace-relative location. **Add file** can create a new working note or import existing files; **Copy path** ensures and copies the portable vault-relative `Files/<Task Title>/` path used by Obsidian Web Clipper; **Open folder** reveals the task workspace in Obsidian.

Use **Move folder** on an active task to relocate its complete task workspace into an existing subfolder of `02 Programs/` or `03 Areas/`. The selected destination receives a readable task collection named after the folder—for example, `Basic Needs Tasks/`—and each relocated task gets its own child folder containing `task.md`, `updates.md`, `Files/`, and any user-created notes or subfolders stored inside that task's bundle. For a standard Inbox task, the ownership boundary is the exact matching `Tasks/<Task Name>/`, `Updates/<Task Name>/`, and `Files/<Task Name>/` folders. The stable ID, status, project tag, metadata, update history, and file references stay together, and references from other tasks are rewritten when they point into the moved task workspace.

## Subtasks

Expand **Subtasks** on a task card or Kanban card and select **Add subtask**.
Each child has a title, status, due date, notes, completion checkbox, file list,
and **Copy path**. Its attachment folder is created immediately under the
parent's existing `Files/Subtasks/<Title>/` directory. Paste the copied path into
Obsidian Clipper to send emails directly to that child. Captured files appear
when the vault refreshes. **Attach file** imports files or creates notes;
**From vault** copies an existing vault file, preserving the original.

Paths are stored relative to the parent Files directory, so parent renames and
**Move folder**, archive, and reopen retain attachment ownership. Copy a fresh
destination after relocating a parent; paths already pasted into an external
Clipper template cannot update themselves. Renaming a subtask changes its display
title while keeping its existing capture destination stable.

Use **More → Convert to subtask** for one existing task or **Convert tasks** in
the header for a reviewed batch. Choose one parent and the source tasks, review
the list, then convert. Notes, status, due date, and history carry over; owned
Files move into the child folder. Original task records are archived. External
shared references remain in those archived records. A task that already has
subtasks cannot be converted again. Batches commit one task at a time and stop
on failure, reporting exactly how many succeeded.

**Promote** creates a full task, moves that child's files into its new Files
directory, and preserves notes and history. Completing the last child does not
automatically complete its parent. Existing tasks are never converted on startup.

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

Task Manager generates `Task Manager Briefing.md` inside the configured active workspace root. The note is rebuilt from the authoritative Task Manager index whenever the dashboard refreshes. It contains every active and archived dashboard task grouped by project tag, plus task details and notes, status, due date, delegation, recent update history, and links back to the task and full update notes.

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

To preview and then backfill missing task-specific Files directories for active
canonical Inbox and project tasks:

```bash
npm run backfill:task-files -- --vault "/path/to/vault"
npm run backfill:task-files -- --vault "/path/to/vault" --apply
```

The backfill creates only one missing final directory beneath an existing
in-vault `Files` parent. It never overwrites, moves, or deletes content, and a
second applied run is a no-op.

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
# Voice conversations

Select **Talk to dashboard** in the dashboard header, then **Start conversation**. Allow microphone access when prompted. You can ask about objectives or request immediate changes, for example “What is due this week?”, “Move the budget review to Waiting”, or “Add an update to the budget review: I sent the draft.” The panel shows the conversation and successful saves. **Mute microphone** pauses your input; **End conversation** stops the call and further queued changes. Closing the panel also ends the call.

Voice uses `gpt-live-1` and the saved OpenAI API key. The **Live voice backend model** setting defaults to `gpt-5.6-terra`. Both models must be available to the key's OpenAI project; voice and backend API usage are billed by OpenAI. No additional local server or catalog write endpoint is opened. The key remains in Obsidian plugin settings and native authenticated HTTP requests, never tool context, transcripts, or data-channel events.

Supported changes are creating an Inbox objective, editing its status/due date/title, and appending progress updates. Ambiguous names need clarification. Existing objectives are edited by ID with a revision check. Voice does not delete, archive, relocate, change project assignments, or manipulate nested actions. A connection error does not undo previously saved changes; check the dashboard before repeating an uncertain request.

The same plugin package supports desktop and mobile. On a phone, synchronize the plugin files through your configured vault/plugin update method and reload the plugin. The voice panel requires WebRTC and microphone permission in Obsidian's mobile webview; it displays an error if unavailable. Backgrounding the app may disconnect voice; restart manually when ready. Never automatically replay a previous spoken change after reconnecting.

Implementation follows official [GPT-Live WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc) and [Responses delegation](https://developers.openai.com/api/docs/guides/live-delegation) contracts. Session creation uses `/v1/live/sessions`, waits for `session.started`, consumes nested completed function items, sends all results before `response.create`, and closes with `session.close`.

## Live voice capture

Choose **Talk to capture** in the capture window. GPT-Live-1 fills visible fields and applies spoken corrections. Review the form and press its **Save** button to persist the capture; voice has no save operation. **Capture to FJG Vault** uses **Continue to Review** and does not save from its first screen. Existing recording and typing remain available. **Mute** pauses microphone input and **End voice** releases the microphone; closing the capture ends voice too. Audio and current capture fields are sent to OpenAI while connected.

Uses the plugin's saved OpenAI key or the existing FJG Objective Manager key. No keys are copied into releases. Touch controls support mobile layouts; update through BRAT on phones that do not sync plugin files. Physical phone microphone/playback verification remains necessary.

The shared implementation is maintained in obsidian-task-manager/apps/obsidian-plugin/src/capture-live and copied into each capture plugin's src/capture-live so each plugin works independently. Keep those copies synchronized when fixing the shared protocol or form tools.

## Broader live search

Live search ranks individual keywords and common word forms instead of requiring an exact phrase. Search coverage is shown in the voice panel. Vault search scans the complete eligible folder/vault scope before paging results; hidden/protected files, unsupported content types, unreadable files and oversized notes are reported separately. Dashboard search covers all indexed objectives, including notes, updates and nested actions, with explicit status filters respected. Ranking is keyword-based, not semantic/vector search. Source matches remain ambiguous until the user identifies the intended note or objective.
