import { describe, expect, it, vi } from "vitest";
import { LiveObjectiveFiles } from "./live-objective-files";
import type { IndexedTask } from "./workspace-service";

const identity = { id: "tsk_one", observedPath: "Inbox/Tasks/One/One - Objective.md", title: "One" };
const file = { relativePath: "Subtasks/Check/Draft.md", extension: "md", size: 10000, revision: "1" };
const pdf = { relativePath: "Scan.pdf", extension: "pdf", size: 100, revision: "1" };
function setup() {
  const task = { taskFile: { path: identity.observedPath },
    record: { task_id: identity.id, title: "One", status: "do-first", due: "2026-12-08", subtasks: [] },
    notes: "Notes on objective One", updates: [] } as unknown as IndexedTask;
  const resolve = vi.fn(() => task);
  const workspace = {
    snapshot: vi.fn(async () => ({ title: identity.title, scopeKey: "one", files: [file, pdf] })),
    readSource: vi.fn(async () => new TextEncoder().encode("A".repeat(9000) + "page two evidence").buffer),
  };
  let active = true;
  const tools = new LiveObjectiveFiles(identity, workspace, resolve, () => active);
  const run = (name: string, args: object = {}) => tools.execute(name, JSON.stringify(args));
  return { run, task, resolve, workspace, stop: () => { active = false; } };
}

describe("read-only objective chat", () => {
  it("reads the original selected objective without accepting any task ID from the model", async () => {
    const f = setup();
    await expect(f.run("read_current_objective")).resolves.toMatchObject({ title: "One", due: "2026-12-08" });
    await expect(f.run("read_current_objective", { task_id: "another" })).rejects.toThrow("Invalid");
    await expect(f.run("find_tasks")).rejects.toThrow("only read");
    await expect(f.run("change_task")).rejects.toThrow("only read");
    expect(f.resolve).toHaveBeenCalledExactlyOnceWith(identity.id);
  });

  it("finds nested files by name, reads pages from only a listed file and never opens unsupported formats", async () => {
    const f = setup();
    await expect(f.run("list_objective_files", { query: "DRAFT", offset: 0 })).resolves.toMatchObject({ total: 1, files: [{ relative_path: file.relativePath }] });
    await expect(f.run("read_objective_file", { relative_path: file.relativePath, offset: 0 })).resolves.toMatchObject({ next_offset: 9000 });
    await expect(f.run("read_objective_file", { relative_path: file.relativePath, offset: 9000 })).resolves.toMatchObject({ text: "page two evidence", next_offset: null });
    await expect(f.run("read_objective_file", { relative_path: pdf.relativePath, offset: 0 })).resolves.toMatchObject({ state: "unsupported format" });
    for (const path of ["../outside.md", "/other/other.md", "Draft.md"]) {
      await expect(f.run("read_objective_file", { relative_path: path, offset: 0 })).rejects.toThrow("Not found");
    }
    expect(f.workspace.readSource.mock.calls).toEqual([[identity, file], [identity, file]]);
  });

  it("fails closed after moving the objective or ending the session mid-read", async () => {
    const f = setup();
    f.task.taskFile.path = "Moved/Objective.md";
    await expect(f.run("list_objective_files", { query: "", offset: 0 })).rejects.toThrow("moved");
    expect(f.workspace.readSource).not.toHaveBeenCalled();
    f.task.taskFile.path = identity.observedPath;
    f.workspace.readSource.mockImplementationOnce(async () => {
      f.stop();
      return new TextEncoder().encode("not shared after closing").buffer;
    });
    await expect(f.run("read_objective_file", { relative_path: file.relativePath, offset: 0 })).rejects.toThrow("ended");
  });
});
