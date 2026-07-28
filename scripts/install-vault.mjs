import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const vaultIndex = args.indexOf("--vault");
const vaultPath = vaultIndex >= 0 ? args[vaultIndex + 1] : process.env.FJG_VAULT_PATH;
if (!vaultPath) {
  process.stderr.write("Provide --vault <path> or set FJG_VAULT_PATH.\n");
  process.exit(1);
}

const pluginSource = path.resolve("apps/obsidian-plugin");
const destination = path.resolve(vaultPath, ".obsidian/plugins/fjg-task-manager");
fs.mkdirSync(destination, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css", "versions.json"]) {
  const source = path.join(pluginSource, file);
  if (!fs.existsSync(source)) throw new Error(`Build output is missing: ${source}`);
  fs.copyFileSync(source, path.join(destination, file));
}
process.stdout.write(`Installed FJG Task Manager to ${destination}\n`);
