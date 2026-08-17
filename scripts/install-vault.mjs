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
const claudianSource = path.resolve("integrations/claudian");
const claudianCommandFolder = path.resolve(vaultPath, ".claude/commands");
const claudianHelperFolder = path.resolve(vaultPath, ".claude/task-manager");
fs.mkdirSync(claudianCommandFolder, { recursive: true });
fs.mkdirSync(claudianHelperFolder, { recursive: true });
fs.copyFileSync(path.join(claudianSource, "task-manager.md"), path.join(claudianCommandFolder, "task-manager.md"));
fs.copyFileSync(path.join(claudianSource, "query.cjs"), path.join(claudianHelperFolder, "query.cjs"));
const codexSkillSource = path.resolve("integrations/codex/task-manager");
const codexSkillFolder = path.resolve(vaultPath, ".agents/skills/task-manager");
fs.mkdirSync(path.dirname(codexSkillFolder), { recursive: true });
fs.cpSync(codexSkillSource, codexSkillFolder, { recursive: true });
process.stdout.write(`Installed FJG Task Manager to ${destination}, Claudian /task-manager, and Codex $task-manager.\n`);
