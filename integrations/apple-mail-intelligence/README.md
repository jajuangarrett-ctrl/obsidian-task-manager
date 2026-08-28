# Apple Mail Intelligence for FJG Obsidian

Three Mail-only macOS Quick Actions use Apple's on-device Foundation Models
framework to turn one selected or open Apple Mail message into a reviewable
Obsidian draft:

- **Create Obsidian Task from Mail**
- **Add Mail to Obsidian Task**
- **Create Obsidian Agenda Item from Mail**

Apple Intelligence never writes the task or agenda item. The Quick Action opens
the corresponding FJG Task Manager or Agenda Capture review modal, and the user
must confirm the final write in Obsidian.

## What is captured

The Mail reader obtains the subject, sender, To and Cc recipients, sent and
received dates, Message-ID, complete readable body, and attachment names from
the selected Mail message. At invocation, choose **Full Email** or **Copied
Excerpt**. Copied Excerpt uses text explicitly highlighted and copied before the
Quick Action runs.

The on-device model proposes task title/details/status/project/due date/
delegation, agenda text/team/priority/hashtag, or a concise task update. Project
and roster values are validated against the current canonical FJG Vault. An
unknown model value becomes **No project** or leaves the existing agenda default;
it cannot create a new project or roster member.

Attachments are not copied by these review actions; their names are retained in
the task details. Use **Save Mail to FJG Vault** when the complete email and
attachment files should be stored beside a task.

## Requirements

- macOS 26 or later on an Apple Intelligence-eligible Mac
- Apple Intelligence enabled and its on-device model ready
- Apple Mail, Obsidian, FJG Task Manager, and Agenda Capture
- Canonical vault at `/Users/franklingarrett/FJG Vault`

No OpenAI or other cloud API is used. The Foundation Models framework executes
the generation on-device.

## Install

Run from the Task Manager repository:

```bash
integrations/apple-mail-intelligence/scripts/install.sh
```

The installer builds and packages the native helper as a foreground-capable app at:

```text
~/Library/Application Support/FJG Task Manager/Mail Intelligence/FJG Mail Intelligence.app
```

The app packaging lets macOS reliably bring the scope chooser and actionable
error alerts in front of Mail. The installer also installs all three workflows
under `~/Library/Services/`.

## Assign shortcuts

Open **System Settings > Keyboard > Keyboard Shortcuts > Services > General**
and assign unused shortcuts. Suggested mappings:

- Create Task: `Control-Option-Command-T`
- Add Task Update: `Control-Option-Command-U`
- Create Agenda Item: `Control-Option-Command-A`

The commands are restricted to Apple Mail. On first use, macOS may ask whether
Automator Runner or `osascript` may control Mail. Allow that request under
**System Settings > Privacy & Security > Automation**.

## Test without Mail or Obsidian

The executable accepts a synthetic Mail JSON file and prints the review URL
without opening Obsidian:

```bash
fjg-mail-intelligence --mode task --message-json message.json --dry-run --no-alerts
```

Use `--check-model` to report `available`, `model-not-ready`, or the relevant
eligibility/setup status.
