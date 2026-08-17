import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const manifest = JSON.parse(fs.readFileSync("apps/obsidian-plugin/manifest.json", "utf8"));
const releaseRoot = path.resolve("release");
const pluginFolder = path.join(releaseRoot, `fjg-task-manager-${manifest.version}`);
fs.rmSync(releaseRoot, { recursive: true, force: true });
fs.mkdirSync(pluginFolder, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css", "versions.json"]) {
  fs.copyFileSync(path.join("apps/obsidian-plugin", file), path.join(pluginFolder, file));
}
fs.cpSync(path.resolve("integrations/claudian"), path.join(pluginFolder, "claudian"), { recursive: true });
fs.cpSync(path.resolve("integrations/codex/task-manager"), path.join(pluginFolder, "codex-task-manager"), { recursive: true });
execFileSync("zip", ["-q", "-r", `fjg-task-manager-${manifest.version}.zip`, path.basename(pluginFolder)], { cwd: releaseRoot });

const clipperDist = path.resolve("apps/browser-clipper/dist");
execFileSync("zip", ["-q", "-r", `fjg-obsidian-task-clipper-${manifest.version}-chrome.zip`, "."], { cwd: clipperDist });
fs.renameSync(
  path.join(clipperDist, `fjg-obsidian-task-clipper-${manifest.version}-chrome.zip`),
  path.join(releaseRoot, `fjg-obsidian-task-clipper-${manifest.version}-chrome.zip`)
);
process.stdout.write(`Release packages created in ${releaseRoot}\n`);
