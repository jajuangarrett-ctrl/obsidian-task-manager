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

  function isSingleChild(parentFolder, destination) {
    const parent = String(parentFolder).replace(/\/+$/, "");
    const folder = String(destination).replace(/\/+$/, "");
    if (!parent || !folder.startsWith(`${parent}/`)) return false;
    const child = folder.slice(parent.length + 1);
    return Boolean(child) && !child.includes("/") && child !== "." && child !== "..";
  }

  function folderPathFromClipboard(value) {
    let path = String(value == null ? "" : value).trim();
    if (!path) throw new Error("The clipboard is empty. Copy one full FJG Vault folder path, then try again.");
    if (/[\r\n]/.test(path)) {
      throw new Error("The clipboard must contain one folder path, not multiple lines.");
    }
    const first = path.charAt(0);
    const last = path.charAt(path.length - 1);
    if (path.length >= 2 && ((first === "\"" && last === "\"") || (first === "'" && last === "'"))) {
      path = path.slice(1, -1).trim();
    }
    if (!path) throw new Error("The clipboard is empty. Copy one full FJG Vault folder path, then try again.");
    return path;
  }

  function resolveFolderPath(vaultRoot, value) {
    const root = String(vaultRoot == null ? "" : vaultRoot).replace(/\/+$/, "");
    const path = folderPathFromClipboard(value);
    if (path.startsWith("/") || path === "~" || path.startsWith("~/")) return path;

    const relative = path.replace(/^FJG Vault(?:\/|$)/, "").replace(/^\/+/, "");
    return relative ? `${root}/${relative}` : root;
  }

  function parseArguments(argv) {
    const args = Array.isArray(argv) ? argv.map(String) : [];
    const result = { folder: "", pasteFolder: false };
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === "--") {
        continue;
      } else if (args[index] === "--folder") {
        if (!args[index + 1]) throw new Error("--folder requires an absolute folder path.");
        result.folder = args[index + 1];
        index += 1;
      } else if (args[index] === "--paste-folder") {
        result.pasteFolder = true;
      } else {
        throw new Error(`Unknown argument: ${args[index]}`);
      }
    }
    if (result.folder && result.pasteFolder) {
      throw new Error("Use either --folder or --paste-folder, not both.");
    }
    return result;
  }

  return {
    availableFileName,
    folderPathFromClipboard,
    isInsideVault,
    isSingleChild,
    normalizeBody,
    parseArguments,
    renderMarkdown,
    resolveFolderPath,
    sanitizeFileName,
    splitExtension
  };
}));
