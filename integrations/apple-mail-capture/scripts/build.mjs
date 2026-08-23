import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const integrationRoot = path.resolve(scriptDirectory, "..");
const core = await readFile(path.join(integrationRoot, "src/core.js"), "utf8");
const runtime = await readFile(path.join(integrationRoot, "src/capture-mail.js"), "utf8");
const outputDirectory = path.join(integrationRoot, "dist");

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "capture-mail.js"),
  `${core.trim()}\n\n${runtime.trim()}\n`,
  "utf8"
);
