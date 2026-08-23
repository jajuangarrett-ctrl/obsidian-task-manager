import fs from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import { parseTaskMarkdown } from "@fjg/task-core";

interface BackfillTarget {
  taskFile: string;
  filesFolder: string;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const vaultIndex = args.indexOf("--vault");
  const vaultArgument = vaultIndex >= 0 ? args[vaultIndex + 1] : "";
  const apply = args.includes("--apply");

  if (!vaultArgument) {
    throw new Error("Usage: npm run backfill:task-files -- --vault /path/to/vault [--apply]");
  }

  const vaultRoot = await fs.realpath(path.resolve(vaultArgument));
  const taskRoot = path.join(vaultRoot, "08 Tasks");
  const inboxRoot = path.join(taskRoot, "Inbox");
  const projectRoot = path.join(taskRoot, "Projects");

  const projectEntries = await readDirectories(projectRoot);
  const workspaces = [inboxRoot, ...projectEntries.map((entry) => path.join(projectRoot, entry.name))];
  const targets: BackfillTarget[] = [];
  const invalidRecords: string[] = [];
  let activeTaskCount = 0;

  for (const workspace of workspaces) {
    const taskEntries = await readDirectories(path.join(workspace, "Tasks"));
    for (const taskEntry of taskEntries) {
      const taskFile = path.join(workspace, "Tasks", taskEntry.name, "task.md");
      if (!(await isRegularFile(taskFile))) continue;
      let document: ReturnType<typeof parseTaskMarkdown>;
      try {
        document = parseTaskMarkdown(await fs.readFile(taskFile, "utf8"));
      } catch (error) {
        invalidRecords.push(
          `${path.relative(vaultRoot, taskFile)}: `
          + `${error instanceof Error ? error.message : String(error)}`
        );
        continue;
      }
      if (document.record.status === "archived") continue;
      activeTaskCount += 1;

      const filesParent = path.join(workspace, "Files");
      await assertExistingInVaultDirectory(filesParent, vaultRoot);
      const filesFolder = path.join(filesParent, taskEntry.name);
      const existing = await lstatOrNull(filesFolder);
      if (existing) {
        if (!existing.isDirectory() || existing.isSymbolicLink()) {
          throw new Error(`A non-directory entry blocks the task Files path: ${filesFolder}`);
        }
        continue;
      }
      targets.push({ taskFile, filesFolder });
    }
  }

  targets.sort((left, right) => left.filesFolder.localeCompare(right.filesFolder));
  process.stdout.write(`${apply ? "Apply" : "Dry-run"} mode\n`);
  process.stdout.write(`Active canonical task records: ${activeTaskCount}\n`);
  process.stdout.write(`Skipped invalid task records: ${invalidRecords.length}\n`);
  for (const invalid of invalidRecords) process.stdout.write(`SKIPPED INVALID ${invalid}\n`);
  process.stdout.write(`Missing task Files directories: ${targets.length}\n`);

  let created = 0;
  for (const target of targets) {
    const relativeFolder = path.relative(vaultRoot, target.filesFolder);
    if (!apply) {
      process.stdout.write(`WOULD CREATE ${relativeFolder}\n`);
      continue;
    }

    await assertExistingInVaultDirectory(path.dirname(target.filesFolder), vaultRoot);
    try {
      await fs.mkdir(target.filesFolder);
      created += 1;
      process.stdout.write(`CREATED ${relativeFolder}\n`);
    } catch (error) {
      const existing = await lstatOrNull(target.filesFolder);
      if (!existing?.isDirectory() || existing.isSymbolicLink()) throw error;
    }
  }

  process.stdout.write(`Created: ${created}\n`);
}

async function readDirectories(folder: string): Promise<Dirent[]> {
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function isRegularFile(file: string): Promise<boolean> {
  const entry = await lstatOrNull(file);
  return Boolean(entry?.isFile() && !entry.isSymbolicLink());
}

async function lstatOrNull(target: string): Promise<Stats | null> {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function assertExistingInVaultDirectory(folder: string, vaultRoot: string): Promise<void> {
  const entry = await lstatOrNull(folder);
  if (!entry?.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`Expected an existing non-symlink Files parent: ${folder}`);
  }
  const canonicalFolder = await fs.realpath(folder);
  const relative = path.relative(vaultRoot, canonicalFolder);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Files parent resolves outside the vault: ${folder}`);
  }
}
