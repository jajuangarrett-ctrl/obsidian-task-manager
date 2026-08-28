/* global Application */
"use strict";

const MAIL = Application("Mail");
MAIL.includeStandardAdditions = true;

function cleanDate(value) {
  if (!value) return "Unknown";
  try { return new Date(value).toISOString(); }
  catch (_) { return String(value); }
}

function formatAddress(recipient) {
  const name = String(recipient.name() || "").trim();
  const address = String(recipient.address() || "").trim();
  if (name && address) return `${name} <${address}>`;
  return address || name || "Unknown recipient";
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

function run() {
  const message = selectedMessage();
  return JSON.stringify({
    subject: String(message.subject() || "(No subject)"),
    sender: String(message.sender() || "Unknown sender"),
    to: message.toRecipients().map(formatAddress),
    cc: message.ccRecipients().map(formatAddress),
    dateSent: cleanDate(message.dateSent()),
    dateReceived: cleanDate(message.dateReceived()),
    messageId: String(message.messageId() || "Not available"),
    body: String(message.content() || ""),
    attachments: message.mailAttachments().map((attachment, index) =>
      String(attachment.name() || `Attachment ${index + 1}`)
    )
  });
}
