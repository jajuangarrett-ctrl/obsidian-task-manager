(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FJGMailCaptureCore = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function cleanText(value, fallback) {
    const text = String(value == null ? "" : value).trim();
    return text || fallback;
  }

  function sanitizeFileName(value, fallback) {
    let name = cleanText(value, fallback || "Email");
    name = name
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/[\/:\[\]#^|]/g, " - ")
      .replace(/\.{2,}/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^\.+/, "")
      .replace(/[. ]+$/, "")
      .trim();
    if (!name) name = fallback || "Email";
    if (name.length > 140) name = name.slice(0, 140).replace(/[. ]+$/, "");
    return name || "Email";
  }

  function splitExtension(fileName) {
    const name = sanitizeFileName(fileName, "Attachment");
    const index = name.lastIndexOf(".");
    if (index <= 0 || index === name.length - 1) return { stem: name, extension: "" };
    return { stem: name.slice(0, index), extension: name.slice(index) };
  }

  function availableFileName(fileName, isTaken) {
    const parts = splitExtension(fileName);
    let candidate = `${parts.stem}${parts.extension}`;
    let suffix = 2;
    while (isTaken(candidate)) {
      candidate = `${parts.stem} (${suffix})${parts.extension}`;
      suffix += 1;
    }
    return candidate;
  }

  function normalizeBody(value) {
    return String(value == null ? "" : value)
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+$/gm, "")
      .trim();
  }

  function inlineMetadata(value, fallback) {
    return cleanText(value, fallback)
      .replace(/\\/g, "\\\\")
      .replace(/\r\n?|\n/g, "<br>");
  }

  function renderMarkdown(message, attachmentNames) {
    const subject = cleanText(message.subject, "(No subject)");
    const recipients = Array.isArray(message.to) ? message.to.join("; ") : message.to;
    const cc = Array.isArray(message.cc) ? message.cc.join("; ") : message.cc;
    const lines = [
      `# ${subject}`,
      "",
      `- **From:** ${inlineMetadata(message.sender, "Unknown sender")}`,
      `- **To:** ${inlineMetadata(recipients, "Not listed")}`,
      `- **Cc:** ${inlineMetadata(cc, "None")}`,
      `- **Sent:** ${inlineMetadata(message.dateSent, "Unknown")}`,
      `- **Received:** ${inlineMetadata(message.dateReceived, "Unknown")}`,
      `- **Subject:** ${inlineMetadata(subject, "(No subject)")}`,
      `- **Message ID:** ${inlineMetadata(message.messageId, "Not available")}`,
      ""
    ];

    if (attachmentNames.length) {
      lines.push("## Attachments", "");
      for (const name of attachmentNames) lines.push(`- [[${name}]]`);
      lines.push("");
    }

    lines.push("## Email", "", normalizeBody(message.body) || "_(Email body was empty.)_", "");
    return lines.join("\n");
  }

  function isInsideVault(vaultRoot, destination) {
    const root = String(vaultRoot).replace(/\/+$/, "");
    const folder = String(destination).replace(/\/+$/, "");
    return folder === root || folder.startsWith(`${root}/`);
  }

  function parseArguments(argv) {
    const args = Array.isArray(argv) ? argv.map(String) : [];
    const result = { folder: "" };
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === "--folder") {
        if (!args[index + 1]) throw new Error("--folder requires an absolute folder path.");
        result.folder = args[index + 1];
        index += 1;
      } else {
        throw new Error(`Unknown argument: ${args[index]}`);
      }
    }
    return result;
  }

  return {
    availableFileName,
    isInsideVault,
    normalizeBody,
    parseArguments,
    renderMarkdown,
    sanitizeFileName,
    splitExtension
  };
}));
