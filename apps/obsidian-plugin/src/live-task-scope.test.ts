import { describe, expect, it, vi } from "vitest";
import { createTaskRecord, taskArtifactUpdatesPath } from "@fjg/task-core";
import { LiveTaskTools } from "./live-tools";
import type { IndexedTask, TaskWorkspaceService } from "./workspace-service";
import type { TaskManagerSettings } from "./settings";

const areaPath = "03 Areas/Admin-leadership/Admin leadership Tasks/Review evaluation/task.md";
const settings = {
  activeRoot: "08 Tasks/Workspaces", inboxRoot: "08 Tasks/Inbox", projectRoot: "08 Tasks/Projects"
} as TaskManagerSettings;

function fixture(path = areaPath, config = settings) {
  const artifact = path.match(/^(.*)\/Tasks\/([^/]+)\/task\.md$/i);
  const folderPath = artifact ? artifact[1] : path.slice(0, path.lastIndexOf("/"));
  const relocated = /^(02 Programs|03 Areas)\//.test(path);
  const updatesPath = artifact ? taskArtifactUpdatesPath(folderPath, artifact[2]) : `${folderPath}/updates.md`;
  const task = {
    record: createTaskRecord({ title: "Review evaluation", status: "do-first" }),
    taskFile: { path, stat: { mtime: 1 } }, updatesFile: { path: updatesPath, stat: { mtime: 2 } },
    folderPath, notes: "", updates: [], relatedFiles: [], archived: false,
    statusAssigned: true, legacyWorkspace: !relocated && !artifact, relocatedBundle: relocated && !artifact
  } as unknown as IndexedTask;
  const addSubtask = vi.fn(async (_id: string, title: string, fields: object) => ({ id: "new-action", title, ...fields }));
  const changeStatus = vi.fn(async () => task);
  const changeDueDate = vi.fn(async () => task);
  const appendUpdate = vi.fn(async () => task);
  const renameTask = vi.fn(async () => task);
  const getById = vi.fn((id: string) => {
    if (id !== task.record.task_id) throw new Error("Objective ID not found or ambiguous.");
    return task;
  });
  const service = { refresh: vi.fn(async () => {}), getById, addSubtask, changeStatus, changeDueDate, appendUpdate, renameTask };
  const changed = vi.fn();
  let active = true;
  const tools = new LiveTaskTools(service as unknown as TaskWorkspaceService, () => config, changed, () => active);
  const revision = () => JSON.stringify([task.record.updated_at, task.taskFile.stat.mtime, task.updatesFile?.stat.mtime ?? 0]);
  const actionArgs = () => ({ task_id: task.record.task_id, expected_revision: revision(), title: "Prepare checklist", notes: "Use the current template", due: "2026-12-01", status: "do-soon" });
  const create = (overrides: object = {}) => tools.execute("create_action", JSON.stringify({ ...actionArgs(), ...overrides }), "test-action");
  const writes = [addSubtask, changeStatus, changeDueDate, appendUpdate, renameTask];
  return { task, service, tools, changed, revision, create, writes, stop: () => { active = false; } };
}

async function expectBlocked(f: ReturnType<typeof fixture>, message = /supported active objective workspaces/) {
  await expect(f.create()).rejects.toThrow(message);
  for (const write of f.writes) expect(write).not.toHaveBeenCalled();
  expect(f.changed).not.toHaveBeenCalled();
}

describe("live objective mutation scope", () => {
  it.each([
    areaPath,
    "03 Areas/Example/Review evaluation/Task.md",
    "02 Programs/Example/Tasks/Review evaluation/Task.md",
    "02 Programs/Example/Example Tasks/Review evaluation/task.md",
    "03 Areas/Example/Tasks/Review evaluation/task.md",
    "02 Programs/Example/Tasks/Review evaluation/task.md"
  ])("creates an action in the indexed relocation layout %s", async (path) => {
    const f = fixture(path);
    const read = await f.tools.execute("read_task", JSON.stringify({ task_id: f.task.record.task_id }), "read") as { revision: string };
    const result = await f.create({ expected_revision: read.revision });
    expect(result).toMatchObject({ saved: true, parent: { task_id: f.task.record.task_id }, action: { title: "Prepare checklist" } });
    expect(f.service.addSubtask).toHaveBeenCalledExactlyOnceWith(f.task.record.task_id, "Prepare checklist", {
      notes: "Use the current template", due: "2026-12-01", status: "do-soon"
    });
    expect(f.changed).toHaveBeenCalledOnce();
  });

  it("permits a relocated objective without an existing update log", async () => {
    const f = fixture(); f.task.updatesFile = null;
    await expect(f.create()).resolves.toMatchObject({ saved: true });
  });

  it.each([
    "08 Tasks/Workspaces/Review evaluation/task.md",
    "08 Tasks/Inbox/Tasks/Review evaluation/task.md",
    "08 Tasks/Projects/Example/Tasks/Review evaluation/task.md"
  ])("preserves configured root support for %s", async (path) => {
    await expect(fixture(path).create()).resolves.toMatchObject({ saved: true });
  });

  it("honors a custom configured active root", async () => {
    await expect(fixture("Work/Objectives/Review evaluation/task.md", { ...settings, activeRoot: "Work/Objectives" }).create())
      .resolves.toMatchObject({ saved: true });
  });

  it.each([
    ["status", "waiting", "changeStatus"], ["due", "2026-12-02", "changeDueDate"],
    ["update", "Checklist prepared", "appendUpdate"], ["rename", "Review checklist", "renameTask"]
  ] as const)("uses the same validated scope for %s changes", async (operation, value, method) => {
    const f = fixture();
    await expect(f.tools.execute("change_task", JSON.stringify({ task_id: f.task.record.task_id,
      expected_revision: f.revision(), operation, value }), "change")).resolves.toMatchObject({ saved: true, operation });
    expect(f.service[method]).toHaveBeenCalledOnce();
  });

  it.each([
    "04 Resources/Review evaluation/task.md",
    "03 Areas/Example/ordinary-note.md",
    "03 Areas Extra/Review evaluation/task.md",
    "03 Areas/Example/../Review evaluation/task.md",
    "03 Areas/Example/./Review evaluation/task.md",
    "03 Areas/Example/.hidden/task.md",
    "03 Areas/Example/Subtasks/Preserved source/task.md",
    "03 Areas/Example\\Review evaluation/task.md",
    "/03 Areas/Example/Review evaluation/task.md",
    "08 Tasks/Workspaces/../Archive/Review evaluation/task.md",
    "08 Tasks/Workspaces-other/Review evaluation/task.md"
  ])("blocks unsupported, attachment, or unsafe paths: %s", async (path) => {
    await expectBlocked(fixture(path));
  });

  it.each([
    "04 Resources/updates.md",
    "03 Areas/Admin-leadership/Admin leadership Tasks/Another objective/updates.md",
    "08 Tasks/Inbox/updates.md",
    "03 Areas/Admin-leadership/Admin leadership Tasks/Review evaluation/../updates.md"
  ])("blocks a mismatched relocated update log: %s", async (path) => {
    const f = fixture(); f.task.updatesFile!.path = path;
    await expectBlocked(f);
  });

  it("blocks another objective's update log in the split artifact layout", async () => {
    const f = fixture("02 Programs/Example/Tasks/Review evaluation/task.md");
    f.task.updatesFile!.path = "02 Programs/Example/Updates/Another objective/updates.md";
    await expectBlocked(f);
  });

  it("preserves the update-root check for configured roots", async () => {
    const f = fixture("08 Tasks/Workspaces/Review evaluation/task.md");
    f.task.updatesFile!.path = "04 Resources/updates.md";
    await expectBlocked(f);
  });

  it("rejects an inconsistent indexed workspace", async () => {
    const f = fixture(); f.task.folderPath = "03 Areas/Another objective";
    await expectBlocked(f);
  });

  it.each(["flag", "status"])("preserves archive protection via %s", async (mode) => {
    const f = fixture();
    if (mode === "flag") f.task.archived = true;
    else f.task.record.status = "archived";
    await expectBlocked(f, /Reopen archived tasks/);
  });

  it("rejects stale revisions before writing", async () => {
    const f = fixture();
    await expect(f.create({ expected_revision: "stale" })).rejects.toThrow(/Task changed since it was read/);
    expect(f.service.addSubtask).not.toHaveBeenCalled();
  });

  it("requires an exact indexed parent ID", async () => {
    const f = fixture();
    await expect(f.create({ task_id: "unknown" })).rejects.toThrow(/not found or ambiguous/);
    expect(f.service.addSubtask).not.toHaveBeenCalled();
  });

  it("does not write after the session ends", async () => {
    const f = fixture(); f.stop();
    await expectBlocked(f, /session has ended/);
  });

  it("retains duplicate-action protection", async () => {
    const f = fixture();
    f.task.record.subtasks.push({ id: "existing-action", title: "Prepare checklist" } as IndexedTask["record"]["subtasks"][number]);
    await expect(f.create()).resolves.toMatchObject({ error: expect.stringContaining("already has an action") });
    expect(f.service.addSubtask).not.toHaveBeenCalled();
  });
});
