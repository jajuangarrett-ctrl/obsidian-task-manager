#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

void main().catch((error) => fail(error instanceof Error ? error.message : String(error)));

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) fail("Enter a task or project question after $task-manager.");

  const vaultPath = process.cwd();
  const settingsPath = path.join(vaultPath, ".obsidian", "plugins", "fjg-task-manager", "data.json");
  let settings;
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  } catch {
    fail("FJG Task Manager settings were not found. Install and enable FJG Task Manager in this vault.");
  }
  if (settings.catalogEnabled === false) {
    fail("FJG Task Manager desktop task search is disabled. Enable Desktop task search in the plugin settings.");
  }
  const port = Number(settings.catalogPort);
  const token = String(settings.catalogToken || "");
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !token) {
    fail("FJG Task Manager desktop task search is not configured. Open its settings and restart the plugin.");
  }

  const url = new URL(`http://127.0.0.1:${port}/query`);
  url.searchParams.set("q", question);
  url.searchParams.set("limit", "30");
  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    fail("FJG Task Manager did not answer. Keep Obsidian open, then reload or re-enable FJG Task Manager and try again.");
  }
  const body = await response.text();
  if (!response.ok) {
    let detail = body;
    try {
      detail = JSON.parse(body).error || body;
    } catch {
      // Keep the plain response body.
    }
    fail(`FJG Task Manager query failed (${response.status}): ${detail || "Unknown error"}`);
  }
  process.stdout.write(`${body}\n`);
}

function fail(message) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exit(1);
}
