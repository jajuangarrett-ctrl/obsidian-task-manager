import fs from "node:fs/promises";
import path from "node:path";
import { planLegacyMigration, LegacyTask } from "./migrate";

const args = parseArgs(process.argv.slice(2));
const inputPath = required("input");
const outputPath = required("output");
const apply = Boolean(args.apply);
const manifestPath = String(args.manifest || path.join(outputPath, "migration-manifest.json"));

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const input = JSON.parse(await fs.readFile(inputPath, "utf8")) as { tasks?: LegacyTask[] } | LegacyTask[];
  const tasks = Array.isArray(input) ? input : Array.isArray(input.tasks) ? input.tasks : [];
  const items = planLegacyMigration(tasks);
  const manifest = {
    version: 1,
    generated_at: new Date().toISOString(),
    input: path.resolve(inputPath),
    output: path.resolve(outputPath),
    apply,
    counts: {
      source: tasks.length,
      import: items.filter((item) => item.action === "import").length,
      skip: items.filter((item) => item.action === "skip").length,
      warnings: items.reduce((sum, item) => sum + item.warnings.length, 0)
    },
    items: items.map(({ taskMarkdown, updatesMarkdown, record, ...item }) => ({
      ...item,
      task_id: record?.task_id,
      status: record?.status
    }))
  };

  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (apply) {
    for (const item of items.filter((value) => value.action === "import")) {
      const folder = path.resolve(outputPath, item.destination);
      assertWithin(outputPath, folder);
      await fs.mkdir(path.join(folder, "attachments"), { recursive: true });
      await writeExclusive(path.join(folder, "task.md"), item.taskMarkdown || "");
      await writeExclusive(path.join(folder, "updates.md"), item.updatesMarkdown || "");
    }
  }

  process.stdout.write(`${JSON.stringify(manifest.counts, null, 2)}\n`);
  process.stdout.write(`Manifest: ${manifestPath}\n`);
  if (!apply) process.stdout.write("Dry run only. Re-run with --apply after reviewing the manifest.\n");
}

function parseArgs(values: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) result[name] = true;
    else {
      result[name] = next;
      index += 1;
    }
  }
  return result;
}

function required(name: string): string {
  const value = args[name];
  if (typeof value !== "string" || !value) {
    process.stderr.write(`Missing --${name}.\n`);
    process.exit(1);
  }
  return value;
}

function assertWithin(root: string, candidate: string): void {
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!candidate.startsWith(prefix)) throw new Error("Migration destination escapes the output root.");
}

async function writeExclusive(filePath: string, contents: string): Promise<void> {
  try {
    await fs.writeFile(filePath, contents, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const existing = await fs.readFile(filePath, "utf8");
      if (existing === contents) return;
      throw new Error(`Migration would overwrite different content: ${filePath}`);
    }
    throw error;
  }
}
