import fs from "node:fs";
import path from "node:path";

const source = path.resolve("apps/obsidian-plugin");
const destination = path.resolve(".");

for (const file of ["main.js", "manifest.json", "styles.css", "versions.json"]) {
  const sourcePath = path.join(source, file);
  if (!fs.existsSync(sourcePath)) throw new Error(`Plugin build output is missing: ${sourcePath}`);
  fs.copyFileSync(sourcePath, path.join(destination, file));
}

process.stdout.write("Synced BRAT-compatible plugin files to the repository root.\n");
