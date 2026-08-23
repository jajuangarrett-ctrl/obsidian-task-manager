/* global Application, ObjC, Path, $, FJGMailCaptureCore */
"use strict";

ObjC.import("Foundation");
ObjC.import("AppKit");

const VAULT_ROOT = "/Users/franklingarrett/FJG Vault";
const HOST = Application.currentApplication();
HOST.includeStandardAdditions = true;
const MAIL = Application("Mail");
const FILE_MANAGER = $.NSFileManager.defaultManager;

function unwrap(value) {
  return ObjC.unwrap(value);
}

function environmentValue(name) {
  const value = $.NSProcessInfo.processInfo.environment.objectForKey($(name));
  return value ? String(unwrap(value)) : "";
}

function canonicalPath(value) {
  const standardized = $(String(value)).stringByStandardizingPath;
  return String(unwrap(standardized.stringByResolvingSymlinksInPath));
}

function joinPath(folder, name) {
  return String(unwrap($(folder).stringByAppendingPathComponent($(name))));
}

function fileExists(path) {
  return Boolean(FILE_MANAGER.fileExistsAtPath($(path)));
}

function isDirectory(path) {
  const directoryFlag = Ref();
  const exists = FILE_MANAGER.fileExistsAtPathIsDirectory($(path), directoryFlag);
  return Boolean(exists) && Boolean(directoryFlag[0]);
}

function writeUtf8(path, content) {
  const error = Ref();
  const ok = $(content).writeToFileAtomicallyEncodingError(
    $(path),
    true,
    $.NSUTF8StringEncoding,
    error
  );
  if (!ok) throw new Error(`Could not write ${path}: ${error[0]}`);
}

function formatAddress(recipient) {
  const name = String(recipient.name() || "").trim();
  const address = String(recipient.address() || "").trim();
  if (name && address) return `${name} <${address}>`;
  return address || name || "Unknown recipient";
}

function formatDate(value) {
  if (!value) return "Unknown";
  const formatter = $.NSDateFormatter.alloc.init;
  formatter.dateFormat = "yyyy-MM-dd HH:mm:ss zzz";
  const result = formatter.stringFromDate(value);
  return result ? String(unwrap(result)) : String(value);
}

function selectedMessage() {
  const messages = MAIL.selection();
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("Open or select one message in Apple Mail, then run the command again.");
  }
  if (messages.length !== 1) {
    throw new Error(`Select exactly one Apple Mail message (currently selected: ${messages.length}).`);
  }
  return messages[0];
}

function clipboardText() {
  const value = $.NSPasteboard.generalPasteboard.stringForType($.NSPasteboardTypeString);
  return value ? String(unwrap(value)) : "";
}

function interactiveDestination() {
  const choice = HOST.displayDialog(
    "Copy the full destination folder path before choosing Paste Folder Path, or browse the FJG Vault normally.",
    {
      withTitle: "Save Mail to FJG Vault",
      buttons: ["Cancel", "Browse Folders…", "Paste Folder Path"],
      defaultButton: "Paste Folder Path",
      cancelButton: "Cancel"
    }
  ).buttonReturned;

  if (choice === "Paste Folder Path") {
    return FJGMailCaptureCore.folderPathFromClipboard(clipboardText());
  }
  return String(HOST.chooseFolder({
    withPrompt: "Choose an existing FJG Vault folder for this email and its attachments.",
    defaultLocation: Path(canonicalPath(VAULT_ROOT))
  }));
}

function chooseDestination(folderArgument, pasteFolder) {
  const vault = canonicalPath(VAULT_ROOT);
  const destination = folderArgument
    || (pasteFolder ? FJGMailCaptureCore.folderPathFromClipboard(clipboardText()) : interactiveDestination());
  const canonicalDestination = canonicalPath(destination);
  if (!isDirectory(canonicalDestination)) {
    throw new Error(`Destination is not an existing folder: ${canonicalDestination}`);
  }
  if (!FJGMailCaptureCore.isInsideVault(vault, canonicalDestination)) {
    throw new Error("Choose a folder inside /Users/franklingarrett/FJG Vault.");
  }
  return canonicalDestination;
}

function messageData(message) {
  return {
    subject: String(message.subject() || "(No subject)"),
    sender: String(message.sender() || "Unknown sender"),
    to: message.toRecipients().map(formatAddress),
    cc: message.ccRecipients().map(formatAddress),
    dateSent: formatDate(message.dateSent()),
    dateReceived: formatDate(message.dateReceived()),
    messageId: String(message.messageId() || "Not available"),
    body: String(message.content() || "")
  };
}

function capture(argv) {
  const options = FJGMailCaptureCore.parseArguments(argv || []);
  const message = selectedMessage();
  const destination = chooseDestination(options.folder, options.pasteFolder);
  const data = messageData(message);
  const reserved = Object.create(null);
  const isTaken = (name) => reserved[name] || fileExists(joinPath(destination, name));

  const noteName = FJGMailCaptureCore.availableFileName(
    `${FJGMailCaptureCore.sanitizeFileName(data.subject, "Email")}.md`,
    isTaken
  );
  reserved[noteName] = true;

  const attachments = message.mailAttachments();
  const attachmentNames = [];
  for (let index = 0; index < attachments.length; index += 1) {
    const requested = FJGMailCaptureCore.sanitizeFileName(
      attachments[index].name() || `Attachment ${index + 1}`,
      `Attachment ${index + 1}`
    );
    const name = FJGMailCaptureCore.availableFileName(requested, isTaken);
    reserved[name] = true;
    MAIL.save(attachments[index], { in: Path(joinPath(destination, name)) });
    attachmentNames.push(name);
  }

  const notePath = joinPath(destination, noteName);
  writeUtf8(notePath, FJGMailCaptureCore.renderMarkdown(data, attachmentNames));
  HOST.displayNotification(
    `${noteName}${attachmentNames.length ? ` plus ${attachmentNames.length} attachment${attachmentNames.length === 1 ? "" : "s"}` : ""}`,
    { withTitle: "Email saved to FJG Vault" }
  );
  return JSON.stringify({
    captured: true,
    notePath,
    attachmentPaths: attachmentNames.map((name) => joinPath(destination, name))
  });
}

function run(argv) {
  try {
    return capture(argv);
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (message.includes("User canceled") || message.includes("-128")) {
      return JSON.stringify({ captured: false, canceled: true });
    }
    if (environmentValue("FJG_MAIL_CAPTURE_NONINTERACTIVE") !== "1") {
      try {
        HOST.displayAlert("Email was not saved", { message, as: "critical" });
      } catch (_) {
        // Automator will still surface the thrown error if the alert cannot open.
      }
    }
    throw new Error(message);
  }
}
