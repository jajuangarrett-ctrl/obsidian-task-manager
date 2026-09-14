/* global Application, ObjC, Path, $, FJGMailCaptureCore */
"use strict";

ObjC.import("Foundation");
ObjC.import("AppKit");

const VAULT_ROOT = "/Users/franklingarrett/FJG Vault";
const LOG_DIRECTORY = "/Users/franklingarrett/Library/Logs/FJG Task Manager";
const LOG_PATH = `${LOG_DIRECTORY}/mail-capture.log`;
const HOST = Application.currentApplication();
HOST.includeStandardAdditions = true;
const MAIL = Application("Mail");
MAIL.includeStandardAdditions = true;
const FILE_MANAGER = $.NSFileManager.defaultManager;
const RUN_ID = `${String(unwrap($.NSProcessInfo.processInfo.processIdentifier))}-${Date.now()}`;
let currentStage = "starting";

function unwrap(value) {
  return ObjC.unwrap(value);
}

function environmentValue(name) {
  const value = $.NSProcessInfo.processInfo.environment.objectForKey($(name));
  return value ? String(unwrap(value)) : "";
}

function canonicalPath(value) {
  const standardized = $(standardizedPath(value));
  return String(unwrap(standardized.stringByResolvingSymlinksInPath));
}

function standardizedPath(value) {
  const expanded = $(String(value)).stringByExpandingTildeInPath;
  return String(unwrap(expanded.stringByStandardizingPath));
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

function ensureDirectory(path) {
  if (isDirectory(path)) return;
  const error = Ref();
  const ok = FILE_MANAGER.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
    $(path),
    true,
    $.NSDictionary.dictionary,
    error
  );
  if (!ok) throw new Error(`Could not create diagnostics folder ${path}: ${error[0]}`);
}

function createSingleDirectory(path) {
  const error = Ref();
  const ok = FILE_MANAGER.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
    $(path),
    false,
    $.NSDictionary.dictionary,
    error
  );
  if (!ok && !isDirectory(path)) {
    throw new Error(`Could not create destination folder ${path}: ${error[0]}`);
  }
}

function appendUtf8(path, content) {
  const data = $(content).dataUsingEncoding($.NSUTF8StringEncoding);
  if (!fileExists(path)) {
    if (!data.writeToFileAtomically($(path), true)) {
      throw new Error(`Could not create diagnostics log ${path}.`);
    }
    return;
  }
  const handle = $.NSFileHandle.fileHandleForWritingAtPath($(path));
  if (!handle) throw new Error(`Could not open diagnostics log ${path}.`);
  handle.seekToEndOfFile;
  handle.writeData(data);
  handle.closeFile;
}

function logStage(stage, detail) {
  currentStage = stage;
  try {
    ensureDirectory(LOG_DIRECTORY);
    const safeDetail = String(detail || "").replace(/[\r\n]+/g, " ").trim();
    appendUtf8(
      LOG_PATH,
      `${new Date().toISOString()} run=${RUN_ID} stage=${stage}${safeDetail ? ` detail=${safeDetail}` : ""}\n`
    );
  } catch (_) {
    // Diagnostics must never prevent or replace the requested capture.
  }
}

function removeCreatedPath(path) {
  if (!fileExists(path)) return "";
  const error = Ref();
  const ok = FILE_MANAGER.removeItemAtPathError($(path), error);
  return ok ? "" : `${path}: ${error[0]}`;
}

function showFailureAlert(message) {
  MAIL.activate();
  MAIL.displayAlert("Email was not saved", {
    message: `${message}\n\nStopped during: ${currentStage}.\nDiagnostics: ${LOG_PATH}`,
    as: "critical"
  });
}

function writeUtf8(path, content) {
  const data = $(content).dataUsingEncoding($.NSUTF8StringEncoding);
  const ok = data.writeToFileAtomically($(path), true);
  if (!ok) throw new Error(`Could not write Markdown file: ${path}`);
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

function safeMessageValue(read, fallback) {
  try {
    const value = read();
    return value == null ? fallback : String(value);
  } catch (_) {
    return fallback;
  }
}

function messageMailboxName(message) {
  return safeMessageValue(() => message.mailbox().name(), "Unknown");
}

function messageSummary(message) {
  return {
    ref: message,
    subject: safeMessageValue(() => message.subject(), "(No subject)"),
    sender: safeMessageValue(() => message.sender(), "Unknown sender"),
    dateSent: formatDate(message.dateSent()),
    dateReceived: formatDate(message.dateReceived()),
    messageId: safeMessageValue(() => message.messageId(), "Not available"),
    mailUid: safeMessageValue(() => message.id(), ""),
    mailbox: messageMailboxName(message)
  };
}

function sameMailMessage(left, right) {
  const leftSummary = messageSummary(left);
  const rightSummary = messageSummary(right);
  if (
    leftSummary.messageId !== "Not available"
    && rightSummary.messageId !== "Not available"
  ) {
    return leftSummary.messageId.toLowerCase() === rightSummary.messageId.toLowerCase();
  }
  return Boolean(leftSummary.mailUid)
    && leftSummary.mailUid === rightSummary.mailUid
    && leftSummary.mailbox === rightSummary.mailbox;
}

function selectedMessageViewer(message) {
  const viewers = MAIL.messageViewers();
  for (let index = 0; index < viewers.length; index += 1) {
    const selected = viewers[index].selectedMessages();
    if (selected.some((candidate) => sameMailMessage(candidate, message))) return viewers[index];
  }
  return null;
}

function mailboxIdentity(mailbox) {
  const name = safeMessageValue(() => mailbox.name(), "Unknown");
  const accountId = safeMessageValue(() => mailbox.account().id(), "Unknown account");
  return `${accountId}:${name}`;
}

function recoveryMailboxes(message, viewerMessages) {
  const mailboxes = [];
  const seen = Object.create(null);
  function add(mailbox) {
    if (!mailbox) return;
    const key = mailboxIdentity(mailbox);
    if (seen[key]) return;
    seen[key] = true;
    mailboxes.push(mailbox);
  }

  add(message.mailbox());
  (viewerMessages || []).forEach((candidate) => {
    try { add(candidate.mailbox()); } catch (_) {}
  });

  try {
    const account = message.mailbox().account();
    account.mailboxes().forEach((mailbox) => {
      const name = safeMessageValue(() => mailbox.name(), "");
      if (/^(?:inbox|sent(?: items| messages)?|archive|all mail|conversation history)$/i.test(name)) {
        add(mailbox);
      }
    });
  } catch (_) {
    // The selected and viewer mailboxes above remain usable when account lookup fails.
  }
  return mailboxes;
}

function searchConversationMailboxes(message, viewerMessages) {
  const subject = FJGMailCaptureCore.conversationSearchSubject(
    safeMessageValue(() => message.subject(), "")
  );
  if (subject.length < 4) return { messages: [], errors: ["The subject is too short for a safe mailbox search."] };

  const messages = [];
  const errors = [];
  recoveryMailboxes(message, viewerMessages).forEach((mailbox) => {
    const mailboxName = safeMessageValue(() => mailbox.name(), "Unknown");
    try {
      logStage("searching-conversation-mailbox", mailboxName);
      const matches = mailbox.messages.whose({ subject: { _contains: subject } })();
      for (let index = 0; index < matches.length; index += 1) {
        messages.push(matches[index]);
        if (messages.length > 200) return;
      }
    } catch (error) {
      errors.push(`${mailboxName}: ${String(error && error.message ? error.message : error)}`);
    }
  });
  return { messages, errors };
}

function selectedConversation() {
  const message = selectedMessage();
  const selected = messageSummary(message);
  logStage("enumerating-conversation", FJGMailCaptureCore.sanitizeFileName(selected.subject, "Email"));

  try {
    const viewer = selectedMessageViewer(message);
    const viewerMessages = viewer ? viewer.messages() : [];
    let plan = FJGMailCaptureCore.planConversationCapture(
      selected,
      viewerMessages.map(messageSummary)
    );
    if (plan.mode === "conversation") {
      return { ...plan, enumerationSource: "message viewer" };
    }

    logStage("recovering-conversation-by-mailbox", FJGMailCaptureCore.sanitizeFileName(selected.subject, "Email"));
    const recovery = searchConversationMailboxes(message, viewerMessages);
    plan = FJGMailCaptureCore.planConversationCapture(
      selected,
      recovery.messages.map(messageSummary)
    );
    if (plan.mode === "conversation") {
      return {
        ...plan,
        enumerationSource: "bounded mailbox search",
        enumerationWarnings: recovery.errors
      };
    }
    if (recovery.errors.length) {
      const errorSummary = recovery.errors.join("; ");
      plan = {
        ...plan,
        limitation: `${plan.limitation || "Apple Mail did not expose a verifiable complete conversation."} Mailbox search reported: ${errorSummary}`
      };
    }
    return { ...plan, enumerationSource: "selected message fallback" };
  } catch (error) {
    const fallback = FJGMailCaptureCore.planConversationCapture(selected, []);
    if (!fallback.limitation) return fallback;
    return {
      ...fallback,
      limitation: `${fallback.limitation} Mail reported: ${String(error && error.message ? error.message : error)}`
    };
  }
}

function confirmSelectedMessageFallback(limitation) {
  if (!limitation) return true;
  if (environmentValue("FJG_MAIL_CAPTURE_NONINTERACTIVE") === "1") {
    throw new Error(`Conversation could not be enumerated: ${limitation}`);
  }
  MAIL.activate();
  const result = MAIL.displayDialog(
    `${limitation}\n\nNo thread files have been written. You can save only the selected message or cancel.`,
    {
      withTitle: "Complete Mail Conversation Unavailable",
      buttons: ["Cancel", "Save Selected Message Only"],
      defaultButton: "Save Selected Message Only",
      cancelButton: "Cancel"
    }
  );
  return result.buttonReturned === "Save Selected Message Only";
}

function clipboardText() {
  const value = $.NSPasteboard.generalPasteboard.stringForType($.NSPasteboardTypeString);
  return value ? String(unwrap(value)) : "";
}

function interactiveDestination() {
  MAIL.activate();
  const choice = MAIL.displayDialog(
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
  const chosenFolder = MAIL.chooseFolder({
    withPrompt: "Choose an existing FJG Vault folder for this email and its attachments.",
    defaultLocation: Path(canonicalPath(VAULT_ROOT))
  });
  if (!chosenFolder) throw new Error("User canceled folder selection. (-128)");
  return String(chosenFolder);
}

function confirmCreateDestination(path) {
  MAIL.activate();
  const result = MAIL.displayDialog(
    `This destination folder does not exist:\n\n${path}\n\nOnly this final folder will be created. Its parent already exists inside the FJG Vault.`,
    {
      withTitle: "Create FJG Vault Folder?",
      buttons: ["Cancel", "Create Folder and Save"],
      defaultButton: "Create Folder and Save",
      cancelButton: "Cancel"
    }
  );
  return result.buttonReturned === "Create Folder and Save";
}

function chooseDestination(folderArgument, pasteFolder) {
  const vault = canonicalPath(VAULT_ROOT);
  const requested = folderArgument
    || (pasteFolder ? FJGMailCaptureCore.folderPathFromClipboard(clipboardText()) : interactiveDestination());
  const destination = standardizedPath(FJGMailCaptureCore.resolveFolderPath(vault, requested));
  const canonicalDestination = canonicalPath(destination);

  if (isDirectory(canonicalDestination)) {
    if (!FJGMailCaptureCore.isInsideVault(vault, canonicalDestination)) {
      throw new Error("Choose a folder inside /Users/franklingarrett/FJG Vault.");
    }
    return { path: canonicalDestination, created: false };
  }

  if (fileExists(destination)) {
    throw new Error(`Destination exists but is not a folder: ${destination}`);
  }

  const parentRequested = String(unwrap($(destination).stringByDeletingLastPathComponent));
  const leafName = String(unwrap($(destination).lastPathComponent));
  const canonicalParent = canonicalPath(parentRequested);
  if (!isDirectory(canonicalParent)) {
    throw new Error(
      `Destination folder does not exist, and its immediate parent is also missing: ${destination}. Only one missing final folder can be created.`
    );
  }
  if (!FJGMailCaptureCore.isInsideVault(vault, canonicalParent)) {
    throw new Error("Choose a folder inside /Users/franklingarrett/FJG Vault.");
  }

  const createPath = joinPath(canonicalParent, leafName);
  if (
    !FJGMailCaptureCore.isInsideVault(vault, createPath)
    || !FJGMailCaptureCore.isSingleChild(canonicalParent, createPath)
  ) {
    throw new Error("Only one missing final folder beneath an existing FJG Vault folder can be created.");
  }
  if (environmentValue("FJG_MAIL_CAPTURE_NONINTERACTIVE") === "1") {
    throw new Error(`Destination folder does not exist: ${createPath}`);
  }

  logStage("confirming-destination-creation", createPath);
  if (!confirmCreateDestination(createPath)) {
    throw new Error("User canceled destination folder creation. (-128)");
  }
  logStage("creating-destination", createPath);
  createSingleDirectory(createPath);

  const createdDestination = canonicalPath(createPath);
  const createdParent = canonicalPath(
    String(unwrap($(createdDestination).stringByDeletingLastPathComponent))
  );
  if (
    !isDirectory(createdDestination)
    || createdParent !== canonicalParent
    || !FJGMailCaptureCore.isInsideVault(vault, createdDestination)
    || !FJGMailCaptureCore.isSingleChild(canonicalParent, createdDestination)
  ) {
    throw new Error("The created destination did not pass the FJG Vault safety check.");
  }
  logStage("destination-created", createdDestination);
  return { path: createdDestination, created: true };
}

function messageData(message) {
  logStage("reading-message-metadata");
  return {
    subject: String(message.subject() || "(No subject)"),
    sender: String(message.sender() || "Unknown sender"),
    to: message.toRecipients().map(formatAddress),
    cc: message.ccRecipients().map(formatAddress),
    dateSent: formatDate(message.dateSent()),
    dateReceived: formatDate(message.dateReceived()),
    messageId: String(message.messageId() || "Not available"),
    mailbox: messageMailboxName(message),
    body: String(message.content() || "")
  };
}

function saveMessage(message, destination, reserved, createdPaths, conversationIndex) {
  const data = messageData(message);
  logStage("message-read", FJGMailCaptureCore.sanitizeFileName(data.subject, "Email"));
  const isTaken = (name) => reserved[name] || fileExists(joinPath(destination, name));
  const requestedNoteName = conversationIndex == null
    ? `${FJGMailCaptureCore.sanitizeFileName(data.subject, "Email")}.md`
    : FJGMailCaptureCore.conversationMessageFileName(data, conversationIndex + 1);
  const noteName = FJGMailCaptureCore.availableFileName(requestedNoteName, isTaken);
  reserved[noteName] = true;

  const attachmentNames = [];
  logStage("reading-attachments", noteName);
  const attachments = message.mailAttachments();
  logStage("attachments-found", `${noteName} count=${attachments.length}`);
  for (let index = 0; index < attachments.length; index += 1) {
    const requested = FJGMailCaptureCore.sanitizeFileName(
      attachments[index].name() || `Attachment ${index + 1}`,
      `Attachment ${index + 1}`
    );
    const name = FJGMailCaptureCore.availableFileName(requested, isTaken);
    reserved[name] = true;
    const attachmentPath = joinPath(destination, name);
    createdPaths.push(attachmentPath);
    logStage("saving-attachment", `${noteName} attachment=${name}`);
    MAIL.save(attachments[index], { in: Path(attachmentPath) });
    attachmentNames.push(name);
  }

  const notePath = joinPath(destination, noteName);
  createdPaths.push(notePath);
  logStage("writing-markdown", noteName);
  writeUtf8(notePath, FJGMailCaptureCore.renderMarkdown(data, attachmentNames));
  return {
    noteName,
    notePath,
    attachmentNames,
    attachmentPaths: attachmentNames.map((name) => joinPath(destination, name))
  };
}

function capture(argv) {
  logStage("started");
  const options = FJGMailCaptureCore.parseArguments(argv || []);
  logStage("reading-mail-selection");
  const conversation = selectedConversation();
  if (conversation.limitation) {
    logStage("conversation-limited", conversation.limitation);
    if (!confirmSelectedMessageFallback(conversation.limitation)) {
      throw new Error("User canceled conversation fallback. (-128)");
    }
  } else {
    logStage(
      "conversation-enumerated",
      `${conversation.mode} count=${conversation.messages.length} via=${conversation.enumerationSource || "selection"}`
    );
    if (conversation.enumerationWarnings && conversation.enumerationWarnings.length) {
      logStage("conversation-enumeration-warning", conversation.enumerationWarnings.join("; "));
    }
  }
  logStage("choosing-destination");
  const destinationResult = chooseDestination(options.folder, options.pasteFolder);
  const parentDestination = destinationResult.path;
  logStage("destination-accepted", parentDestination);
  const createdPaths = destinationResult.created ? [parentDestination] : [];
  let destination = parentDestination;
  let threadFolder = "";
  try {
    if (conversation.mode === "conversation") {
      const requestedFolder = FJGMailCaptureCore.conversationFolderName(
        conversation.messages[0].subject
      );
      const folderName = FJGMailCaptureCore.availableFolderName(
        requestedFolder,
        (name) => fileExists(joinPath(parentDestination, name))
      );
      destination = joinPath(parentDestination, folderName);
      logStage("creating-thread-folder", folderName);
      createSingleDirectory(destination);
      createdPaths.push(destination);
      threadFolder = destination;
    }

    const reserved = Object.create(null);
    const results = conversation.messages.map((summary, index) => saveMessage(
      summary.ref,
      destination,
      reserved,
      createdPaths,
      conversation.mode === "conversation" ? index : null
    ));

    const notePaths = results.map((result) => result.notePath);
    const attachmentPaths = results.reduce(
      (paths, result) => paths.concat(result.attachmentPaths),
      []
    );
    logStage("completed", `${destination} messages=${results.length}`);
    if (conversation.mode === "conversation") {
      HOST.displayNotification(
        `${results.length} messages${attachmentPaths.length ? ` plus ${attachmentPaths.length} attachment${attachmentPaths.length === 1 ? "" : "s"}` : ""} in ${String(unwrap($(destination).lastPathComponent))}`,
        { withTitle: "Mail conversation saved to FJG Vault" }
      );
    } else {
      const result = results[0];
      HOST.displayNotification(
        `${result.noteName}${result.attachmentPaths.length ? ` plus ${result.attachmentPaths.length} attachment${result.attachmentPaths.length === 1 ? "" : "s"}` : ""}${conversation.limitation ? "; selected message only" : ""}`,
        { withTitle: "Email saved to FJG Vault" }
      );
    }
    return JSON.stringify({
      captured: true,
      mode: conversation.mode,
      messageCount: results.length,
      threadFolder,
      notePath: notePaths[0],
      notePaths,
      attachmentPaths,
      conversationLimitation: conversation.limitation || "",
      enumerationSource: conversation.enumerationSource || "selection"
    });
  } catch (error) {
    logStage("cleaning-partial-files");
    const cleanupFailures = createdPaths.slice().reverse().map(removeCreatedPath).filter(Boolean);
    if (cleanupFailures.length) {
      throw new Error(
        `${String(error && error.message ? error.message : error)} Cleanup also failed: ${cleanupFailures.join("; ")}`
      );
    }
    throw error;
  }
}

function run(argv) {
  try {
    return capture(argv);
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    const failedStage = currentStage;
    logStage("failed", `at=${failedStage} ${message}`);
    currentStage = failedStage;
    if (message.includes("User canceled") || message.includes("-128")) {
      logStage("canceled");
      return JSON.stringify({ captured: false, canceled: true });
    }
    if (environmentValue("FJG_MAIL_CAPTURE_NONINTERACTIVE") === "1") {
      throw new Error(message);
    }
    try {
      showFailureAlert(message);
    } catch (_) {
      try {
        HOST.displayAlert("Email was not saved", { message, as: "critical" });
      } catch (_) {}
    }
    return JSON.stringify({ captured: false, error: message });
  }
}
