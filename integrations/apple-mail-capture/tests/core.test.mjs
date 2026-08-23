import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const core = require("../src/core.js");

test("sanitizes subjects into readable macOS-safe filenames", () => {
  assert.equal(
    core.sanitizeFileName("Protect and Progress Meeting: August Agenda"),
    "Protect and Progress Meeting - August Agenda"
  );
  assert.equal(core.sanitizeFileName("[Final] Agenda #1.pdf"), "- Final - Agenda - 1.pdf");
  assert.equal(core.sanitizeFileName("../../"), "- -");
});

test("allocates non-overwriting note and attachment names", () => {
  const taken = new Set(["Agenda.pdf", "Agenda (2).pdf", "Meeting.md"]);
  assert.equal(core.availableFileName("Agenda.pdf", (name) => taken.has(name)), "Agenda (3).pdf");
  assert.equal(core.availableFileName("Meeting.md", (name) => taken.has(name)), "Meeting (2).md");
});

test("accepts the vault root and descendants but rejects sibling prefixes", () => {
  const root = "/Users/franklingarrett/FJG Vault";
  assert.equal(core.isInsideVault(root, root), true);
  assert.equal(core.isInsideVault(root, `${root}/08 Tasks/Projects/Meeting/Files`), true);
  assert.equal(core.isInsideVault(root, "/Users/franklingarrett/FJG Vault Old"), false);
});

test("reads one pasted full folder path and rejects empty or multiline clipboard text", () => {
  const path = "/Users/franklingarrett/FJG Vault/08 Tasks/Projects/Meeting/Files";
  assert.equal(core.folderPathFromClipboard(`  ${path}\n`), path);
  assert.equal(core.folderPathFromClipboard(`"${path}"`), path);
  assert.throws(() => core.folderPathFromClipboard("   "), /clipboard is empty/i);
  assert.throws(() => core.folderPathFromClipboard(`${path}\n${path}`), /one folder path/i);
});

test("resolves Obsidian vault-relative paths against the canonical vault", () => {
  const root = "/Users/franklingarrett/FJG Vault";
  const relative = "08 Tasks/Projects/City CE Transfer Day/Files";
  assert.equal(core.resolveFolderPath(root, relative), `${root}/${relative}`);
  assert.equal(core.resolveFolderPath(root, `FJG Vault/${relative}`), `${root}/${relative}`);
  assert.equal(core.resolveFolderPath(root, `${root}/${relative}`), `${root}/${relative}`);
  assert.equal(core.resolveFolderPath(root, "FJG Vault"), root);
});

test("renders complete readable mail metadata, body, and attachment links", () => {
  const markdown = core.renderMarkdown({
    subject: "Protect and Progress Meeting: August Agenda",
    sender: "Roberto Marin <rmarin@example.edu>",
    to: ["Franklin Garrett <fgarrett@example.edu>"],
    cc: [],
    dateSent: "2026-08-22 09:30:00 PDT",
    dateReceived: "2026-08-22 09:31:00 PDT",
    messageId: "example-message-id",
    body: "Franklin,\r\n\r\nHere is the complete August agenda.\r\n\r\nRoberto"
  }, ["Protect and Progress August Agenda.pdf"]);

  assert.match(markdown, /^# Protect and Progress Meeting: August Agenda/m);
  assert.match(markdown, /\*\*From:\*\* Roberto Marin/);
  assert.match(markdown, /\*\*To:\*\* Franklin Garrett/);
  assert.match(markdown, /\[\[Protect and Progress August Agenda\.pdf\]\]/);
  assert.match(markdown, /Here is the complete August agenda\./);
  assert.ok(markdown.endsWith("\n"));
});

test("parses an explicit destination folder cleanly", () => {
  assert.deepEqual(core.parseArguments(["--folder", "/tmp/FJG Vault/Files"]), {
    folder: "/tmp/FJG Vault/Files",
    pasteFolder: false
  });
  assert.deepEqual(core.parseArguments(["--", "--paste-folder"]), { folder: "", pasteFolder: true });
  assert.throws(() => core.parseArguments(["--folder"]), /requires an absolute folder path/);
  assert.throws(
    () => core.parseArguments(["--folder", "/tmp/FJG Vault/Files", "--paste-folder"]),
    /either --folder or --paste-folder/
  );
  assert.throws(() => core.parseArguments(["--unexpected"]), /Unknown argument/);
});
