# Apple Mail capture for FJG Vault

`Save Mail to FJG Vault` is a macOS Quick Action for a message or conversation
selected or open in Apple Mail. It asks for a destination inside the real FJG
Vault. A single message remains one readable Markdown note with its attachments
beside it. When Mail exposes multiple members of the selected conversation, the
Quick Action creates one collision-safe `… - Mail Thread` folder, then saves one
Markdown note per message and every attachment in that shared folder. This
works with ordinary vault folders and Task Manager `Files` folders, including
relocated task workspaces under `02 Programs/` and `03 Areas/`.

The capture does not create or use a generic mail archive. It never replaces an
existing note, thread folder, or attachment: filename conflicts receive `(2)`,
`(3)`, and so on. Every Markdown note contains the subject, sender, To and Cc
recipients, sent and received dates, message ID, source mailbox, complete
readable body returned by Apple Mail, and same-folder Obsidian links for that
message's attachments.

## Install

From this repository, run:

```bash
integrations/apple-mail-capture/scripts/install.sh
```

The installer puts the self-contained capture script in:

```text
~/Library/Application Support/FJG Task Manager/Mail Capture/capture-mail.js
```

and installs the Mail Quick Action at:

```text
~/Library/Services/Save Mail to FJG Vault.workflow
```

## Use from Mail

1. Open Apple Mail and select or open one message in the conversation to save.
2. Choose **Mail > Services > Save Mail to FJG Vault**.
3. To use an exact path, copy the full folder path before invoking the command,
   then choose **Paste Folder Path**. The workflow reads the clipboard directly;
   there is no need to press Command-V in the macOS folder panel. Paths copied
   from Obsidian may be vault-relative (for example,
   `08 Tasks/Projects/Meeting/Files`) or absolute.
4. Alternatively, choose **Browse Folders…** and select a destination in the
   actual FJG Vault hierarchy. For a Task Manager item, choose that task
   workspace's `Files` folder.

For a conversation, choose the parent destination once. The Quick Action makes
a uniquely named thread folder there and saves each message as a separately
dated Markdown file, in chronological order. A non-thread message keeps the
original behavior and saves directly into the chosen destination.

An empty clipboard, multiple clipboard lines, or a folder outside the canonical
FJG Vault is rejected before the email or any attachment is written. If exactly
the final destination folder is missing beneath an existing in-vault parent,
Mail offers **Create Folder and Save** or **Cancel**; it never creates multiple
missing levels. Both the existing parent and the new folder are canonicalized
and checked against the vault boundary. Errors are brought to the foreground
with the failed stage and the local diagnostics path. The stage log is stored at
`~/Library/Logs/FJG Task Manager/mail-capture.log`; it never contains the email
body.

On first use, macOS may ask whether the Quick Action, Automator Runner, or
`osascript` may control Mail. Allow that Automation request in **System
Settings > Privacy & Security > Automation**. The workflow cannot read the
selected message until this Apple automation permission is granted.

## Assign a keyboard shortcut

1. Open **System Settings > Keyboard > Keyboard Shortcuts**.
2. Open **Services**, then the **General** section.
3. Find **Save Mail to FJG Vault** and assign an unused shortcut, such as
   `Control-Option-Command-S`.
4. Return to Mail, open a message or conversation, and press the shortcut.

If the Quick Action is not immediately listed, log out and back in or restart
the Mac after installation so Launch Services refreshes its Services menu.

## Pass a destination folder directly

An automation that already has an exact folder can bypass the chooser without
changing the capture model:

```bash
/usr/bin/osascript -l JavaScript \
  "$HOME/Library/Application Support/FJG Task Manager/Mail Capture/capture-mail.js" \
  -- --folder "/Users/franklingarrett/FJG Vault/08 Tasks/Projects/Example/Files"
```

The script canonicalizes the path and rejects destinations outside
`/Users/franklingarrett/FJG Vault`. It may create exactly one missing final
folder beneath an existing in-vault parent after explicit confirmation.

## Known boundaries

- Apple Mail does not expose a public conversation ID to automation. The Quick
  Action first uses the active message viewer's conversation members. When Mail
  gives automation only the selected result while visibly rendering a larger
  conversation, it performs a bounded subject search of the selected mailbox
  plus that account's Inbox, Sent, Archive, All Mail, and Conversation History
  mailboxes. It verifies normalized subjects, removes duplicates, and records
  each member's source mailbox. The selected mailbox may be any other user
  mailbox, so filed messages are included when the invocation starts there.
- If Mail exposes only a selected reply, a mixed message list, or too many
  messages to verify safely, the Quick Action explains the limitation before
  any write and offers **Save Selected Message Only** or **Cancel**. It never
  silently claims that an incomplete thread is complete.
- The body is Mail's complete readable `content` value (plain readable text),
  not a pixel-perfect HTML export.
- Mail may need to download a remote body or attachment before the save can
  finish. Exchange latency is controlled by Mail and can delay the Quick Action.
- Calendar invitation MIME parts that Mail renders as an event banner are not
  exposed by Mail as ordinary `mail attachments`; only attachments in Mail's
  scripting attachment collection are saved as separate files.
- Inline signature images exposed by Mail as attachments are saved and linked
  like other attachments.
