# Apple Mail capture for FJG Vault

`Save Mail to FJG Vault` is a macOS Quick Action for one message selected or
open in Apple Mail. It asks for an existing destination folder inside the real
FJG Vault, then writes a readable Markdown note and saves every Mail attachment
beside it. This works with ordinary vault folders and Task Manager `Files`
folders, including relocated task workspaces under `02 Programs/` and
`03 Areas/`.

The capture does not create or use a generic mail archive. It never replaces an
existing note or attachment: filename conflicts receive `(2)`, `(3)`, and so
on. The Markdown note contains the subject, sender, To and Cc recipients, sent
and received dates, message ID, complete readable body returned by Apple Mail,
and same-folder Obsidian links for attachments.

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

1. Open Apple Mail and select or open exactly one message.
2. Choose **Mail > Services > Save Mail to FJG Vault**.
3. To use an exact path, copy the full folder path before invoking the command,
   then choose **Paste Folder Path**. The workflow reads the clipboard directly;
   there is no need to press Command-V in the macOS folder panel. Paths copied
   from Obsidian may be vault-relative (for example,
   `08 Tasks/Projects/Meeting/Files`) or absolute.
4. Alternatively, choose **Browse Folders…** and select a destination in the
   actual FJG Vault hierarchy. For a Task Manager item, choose that task
   workspace's `Files` folder.

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
4. Return to Mail, open one message, and press the shortcut.

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

The script canonicalizes the path, requires that it already exists, and rejects
destinations outside `/Users/franklingarrett/FJG Vault`.

## Known boundaries

- Capture is one selected Apple Mail message at a time.
- The body is Mail's complete readable `content` value (plain readable text),
  not a pixel-perfect HTML export.
- Mail may need to download a remote body or attachment before the save can
  finish. Exchange latency is controlled by Mail and can delay the Quick Action.
- Calendar invitation MIME parts that Mail renders as an event banner are not
  exposed by Mail as ordinary `mail attachments`; only attachments in Mail's
  scripting attachment collection are saved as separate files.
- Inline signature images exposed by Mail as attachments are saved and linked
  like other attachments.
