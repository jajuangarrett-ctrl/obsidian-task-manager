import { normalizeStatus, TaskStatus } from "@fjg/task-core";
import { DiskTaskStore } from "./store";

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const vault = String(args.vault || process.env.FJG_VAULT_PATH || "");
if (!vault) fail("Provide --vault <path> or set FJG_VAULT_PATH.");
const store = new DiskTaskStore(vault, String(args.root || "08 Tasks/Workspaces"), String(args.archive || "08 Tasks/Archive"));

void run().catch((error) => fail(error instanceof Error ? error.message : String(error)));

async function run(): Promise<void> {
  if (command === "list") {
    const tasks = (await store.list(Boolean(args["include-archived"])))
      .filter((task) => !args.status || task.record.status === normalizeStatus(args.status))
      .filter((task) => !args.project || task.record.project === args.project);
    output(args.json ? tasks.map((task) => task.record) : tasks.map((task) => `${task.record.task_id}\t${task.record.status}\t${task.record.title}`).join("\n"));
    return;
  }
  if (command === "show") {
    output((await store.get(required("id"))).record);
    return;
  }
  if (command === "create") {
    const task = await store.create({
      title: required("title"),
      details: String(args.details || ""),
      status: String(args.status || "inbox"),
      project: String(args.project || ""),
      due: String(args.due || ""),
      delegatedTo: String(args["delegated-to"] || ""),
      tags: ["task"]
    });
    output(task.record);
    return;
  }
  if (command === "update") {
    await store.appendUpdate(required("id"), String(args.actor || "Codex"), required("text"));
    output({ ok: true, task_id: args.id });
    return;
  }
  if (command === "status") {
    await store.changeStatus(required("id"), normalizeStatus(required("to")) as TaskStatus, String(args.actor || "Codex"));
    output({ ok: true, task_id: args.id, status: normalizeStatus(String(args.to)) });
    return;
  }
  if (command === "validate") {
    const issues = await store.validate();
    output({ ok: issues.length === 0, issues });
    if (issues.length) process.exitCode = 1;
    return;
  }
  fail("Commands: list, show, create, update, status, validate");
}

function parseArgs(values: string[]): Record<string, any> & { _: string[] } {
  const result: Record<string, any> & { _: string[] } = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function required(name: string): string {
  const value = String(args[name] || "");
  if (!value) fail(`Missing --${name}.`);
  return value;
}

function output(value: unknown): void {
  if (typeof value === "string") process.stdout.write(`${value}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
