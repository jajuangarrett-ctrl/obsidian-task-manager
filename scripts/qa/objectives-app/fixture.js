import { TFile } from "obsidian";
import { ObjectivesAppView } from "../../../apps/obsidian-plugin/src/objectives-app-view.ts";

window.fixtureEvents = [];
const make = (id, title, status, extra = {}) => {
  const folderPath = `08 Tasks/Inbox/Files/${title}`;
  const taskFile = new TFile(`${folderPath}/Task.md`);
  const relatedFiles = [{ file: new TFile(`${folderPath}/Files/Notes.md`), kind: "file", preview: "" }];
  return { taskFile, folderPath, relatedFiles, updates: [], updatesFile: undefined, notes: "Synthetic note text.", archived: false, statusAssigned: true, record: {
    task_id: id, title, status, due: "", project: "", people: [], tags: [], delegated_to: "", priority: "normal", subtasks: [],
    created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-02T00:00:00Z",
    ...extra,
  } };
};
const tasks = [
  make("tsk_alpha", "Fixture Alpha", "do-first", { subtasks: [{ id: "action_1", title: "Write fixture outline", notes: "No vault writes.", status: "do-soon", completed: false, due: "" }] }),
  make("tsk_ongoing", "Fixture Ongoing", "ongoing"),
  make("tsk_inbox", "Fixture Inbox", "inbox"),
  make("tsk_complete", "Fixture Completed", "completed"),
  make("tsk_archived", "Fixture Legacy Archive", "completed", { __fjgSourceArchived: true }),
  make("tsk_converted", "Fixture Converted", "completed", { converted_to: { parent_task_id: "tsk_alpha", action_id: "action_1", converted_at: "2025-01-02T00:00:00Z" } }),
  ...Array.from({ length: 36 }, (_, n) => make(`tsk_scroll_${n}`, `Scroll Fixture ${String(n).padStart(2, "0")}`, "do-first")),
];
const history = window.fixtureEvents;
const record = (name) => (...args) => { history.push({ name, args: args.map(arg => typeof arg === "function" ? arg() : arg?.path ?? arg) }); };
const lookup = (id) => {
  if (duplicate.has(id)) throw new Error("Duplicate objective ID requires review.");
  const item = tasks.find(t => t.record.task_id === id);
  if (!item) throw new Error("Objective is not available.");
  return item;
};
const duplicate = new Set();
const app = {
  loadLocalStorage: key => JSON.parse(localStorage.getItem(key) ?? "null"),
  saveLocalStorage: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
  workspace: { requestSaveLayout() {}, getLeaf: () => ({ openFile: record("workspace.openFile") }) },
  vault: { read: async () => "Synthetic rendered note" },
};
const service = {
  getById: lookup,
  list: ({ includeArchived = false } = {}) => includeArchived ? tasks : tasks.filter(t => !t.archived),
  objectiveFiles: id => lookup(id).relatedFiles,
  startHereFile: () => null,
  getDuplicateTaskPaths: id => duplicate.has(id) ? [lookupPath(id), "08 Tasks/Inbox/Duplicate/Task.md"] : [],
  duplicatePaths: id => duplicate.has(id) ? [lookupPath(id), "08 Tasks/Inbox/Duplicate/Task.md"] : [],
  projectNames: () => [],
  copyFolderForTask: id => ({ folderPath: lookup(id).folderPath + "/Files", legacy: false }),
  async refresh() {},
};
const lookupPath = id => tasks.find(t => t.record.task_id === id)?.taskFile.path;
const plugin = {
  app, workspaceService: service, settings: { activeRoot: "08 Tasks", inboxRoot: "08 Tasks/Inbox" },
  openLiveVoice: record("openLiveVoice"),
  openQuickCaptureModal: record("openQuickCaptureModal"),
  openCreateModal: record("openCreateModal"),
  showTaskFileLocationInFileFocus: record("showTaskFileLocationInFileFocus"),
  copyTaskFolderPath: record("copyTaskFolderPath"),
  openUpdateModal: record("openUpdateModal"),
  openObjectiveActionModal: record("openObjectiveActionModal"),
  openRelatedFile: record("openRelatedFile"),
  openTask: record("openTask"),
  activateDashboard: record("activateDashboard"),
  refreshDashboard() {},
};
const leaf = { root: document.querySelector(".workspace-leaf"), containerEl: document.querySelector(".workspace-leaf"), app };
const view = new ObjectivesAppView(leaf, plugin);
window.fixture = {
  duplicate(id = "tsk_alpha") { duplicate.add(id); },
  removeDuplicate(id = "tsk_alpha") { duplicate.delete(id); },
  rerender() { return view.render(); },
  close() { return view.onClose(); },
};
Promise.resolve(view.onOpen()).then(() => { document.body.dataset.fixtureReady = "true"; }).catch(error => { document.body.dataset.fixtureError = String(error); throw error; });
