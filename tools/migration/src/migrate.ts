import {
  appendUpdateMarkdown,
  createProjectRecord,
  createTaskRecord,
  normalizeStatus,
  normalizeProjectName,
  numberedTaskFolderName,
  renderTaskMarkdown,
  renderProjectMarkdown,
  renderUpdatesMarkdown,
  sanitizeTitleForPath,
  ProjectRecord,
  TaskRecord,
} from "@fjg/task-core";

export interface LegacyUpdate {
  id?: string;
  date?: string;
  createdAt?: string;
  text?: string;
  source?: string;
}

export interface LegacyTask {
  id?: string;
  title?: string;
  raw?: string;
  details?: string;
  source?: string;
  bucket?: string;
  status?: string;
  done?: boolean;
  urgent?: boolean;
  priority?: string;
  project?: string | null;
  assignee?: string | null;
  dueDate?: string | null;
  doneDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedAt?: string | null;
  tags?: string[];
  updates?: LegacyUpdate[];
}

export interface MigrationItem {
  legacyId: string;
  title: string;
  action: "import" | "skip";
  reason: string;
  destination: string;
  warnings: string[];
  record?: TaskRecord;
  taskMarkdown?: string;
  updatesMarkdown?: string;
  legacyTags: string[];
}

export interface ProjectMigrationItem {
  name: string;
  action: "import" | "skip";
  reason: string;
  destination: string;
  source: "managed-list" | "task-reference";
  warnings: string[];
  record?: ProjectRecord;
  projectMarkdown?: string;
}

export function planLegacyMigration(
  tasks: LegacyTask[],
  options: { activeRoot?: string; archiveRoot?: string; now?: Date } = {}
): MigrationItem[] {
  const activeRoot = options.activeRoot || "08 Tasks/Workspaces";
  const archiveRoot = options.archiveRoot || "08 Tasks/Archive";
  const fallbackTimestamp = options.now?.toISOString() || "1970-01-01T00:00:00.000Z";
  const seen = new Set<string>();
  const folderCounts = new Map<string, number>();
  return tasks.map((legacy, index) => {
    const legacyId = clean(legacy.id) || `legacy_${String(index + 1).padStart(4, "0")}`;
    const title = clean(legacy.title) || extractTitle(legacy.raw) || `Untitled legacy task ${index + 1}`;
    const warnings: string[] = [];
    if (legacy.deletedAt) return skip(legacyId, title, "Legacy task is deleted.", legacy.tags);
    if (seen.has(legacyId)) return skip(legacyId, title, "Duplicate legacy task ID.", legacy.tags);
    seen.add(legacyId);
    const sourceStatus = clean(legacy.status || legacy.bucket);
    const status = legacy.done ? "completed" : normalizeStatus(sourceStatus);
    if (/^cancel/i.test(sourceStatus)) warnings.push("Cancelled mapped to archived; legacy status preserved.");
    const createdAt = validTimestamp(legacy.createdAt) || fallbackTimestamp;
    if (!legacy.createdAt) warnings.push("Missing createdAt; deterministic migration fallback used.");
    const record = createTaskRecord({
      taskId: legacyId,
      title,
      details: clean(legacy.details),
      status,
      priority: legacy.urgent || legacy.priority === "high" ? "high" : "normal",
      due: validDate(legacy.dueDate),
      project: clean(legacy.project),
      delegatedTo: clean(legacy.assignee),
      source: { type: "migration", title: clean(legacy.source), url: "" },
      tags: ["task"],
      legacyIds: [legacyId],
      legacyStatus: sourceStatus,
      createdAt,
      updatedAt: validTimestamp(legacy.updatedAt) || createdAt
    }, new Date(fallbackTimestamp));
    if (status === "completed" && legacy.doneDate) record.completed_at = validTimestamp(legacy.doneDate) || `${legacy.doneDate}T12:00:00.000Z`;
    const root = status === "archived" ? archiveRoot : activeRoot;
    const folderKey = `${root}/${sanitizeTitleForPath(record.title)}`.toLocaleLowerCase();
    const copyNumber = (folderCounts.get(folderKey) || 0) + 1;
    folderCounts.set(folderKey, copyNumber);
    const destination = `${root}/${numberedTaskFolderName(record.task_id, record.title, copyNumber)}`;
    let updates = appendUpdateMarkdown(renderUpdatesMarkdown(), {
      updateId: `upd_migration_${safeId(legacyId)}`,
      actor: "Task Manager migration",
      type: "migration",
      text: `Imported from the legacy Taskboard${sourceStatus ? ` with status ${sourceStatus}` : ""}.`,
      newStatus: record.status,
      createdAt
    });
    const sortedUpdates = [...(legacy.updates || [])].sort(compareUpdates);
    for (let updateIndex = 0; updateIndex < sortedUpdates.length; updateIndex += 1) {
      const update = sortedUpdates[updateIndex];
      if (!clean(update.text)) continue;
      updates = appendUpdateMarkdown(updates, {
        updateId: clean(update.id) || `upd_migration_${safeId(legacyId)}_${String(updateIndex + 1).padStart(4, "0")}`,
        actor: clean(update.source) || "Legacy Taskboard",
        type: "migration",
        text: clean(update.text),
        createdAt: validTimestamp(update.createdAt) || validTimestamp(update.date) || createdAt
      });
    }
    const body = [
      `# ${record.title}`,
      "",
      "## Outcome",
      "",
      "",
      "## Details",
      "",
      clean(legacy.details),
      "",
      "## Source",
      "",
      clean(legacy.source),
      "",
      "## Related files",
      "",
      ""
    ].join("\n").replace(/\n{3,}/g, "\n\n");
    const legacyTags = Array.isArray(legacy.tags) ? legacy.tags.filter((tag) => tag !== "task") : [];
    if (legacyTags.length) warnings.push("Legacy tags recorded in the manifest but not imported pending explicit review.");
    return {
      legacyId,
      title,
      action: "import",
      reason: "",
      destination,
      warnings,
      record,
      taskMarkdown: renderTaskMarkdown(record, body),
      updatesMarkdown: updates,
      legacyTags
    };
  });
}

export function planLegacyProjectMigration(
  managedProjects: unknown[],
  tasks: LegacyTask[],
  options: { projectRoot?: string; createdAt?: string } = {}
): ProjectMigrationItem[] {
  const projectRoot = options.projectRoot || "08 Tasks/Projects";
  const createdAt = validTimestamp(options.createdAt) || "1970-01-01T00:00:00.000Z";
  const seen = new Set<string>();
  const folderCounts = new Map<string, number>();
  const items: ProjectMigrationItem[] = [];

  for (const rawName of managedProjects) {
    const name = normalizeProjectName(rawName);
    const key = normalizeProjectKey(name);
    if (!name) {
      items.push({
        name: "",
        action: "skip",
        reason: "Managed project name is empty.",
        destination: "",
        source: "managed-list",
        warnings: []
      });
      continue;
    }
    if (seen.has(key)) {
      items.push({
        name,
        action: "skip",
        reason: "Duplicate managed project name.",
        destination: "",
        source: "managed-list",
        warnings: []
      });
      continue;
    }
    seen.add(key);
    items.push(createProjectMigrationItem(name, "managed-list", projectRoot, createdAt, folderCounts));
  }

  const referenced = [...new Set(
    tasks.map((task) => normalizeProjectName(task.project)).filter(Boolean)
  )].sort((left, right) => left.localeCompare(right));
  for (const name of referenced) {
    const key = normalizeProjectKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const item = createProjectMigrationItem(name, "task-reference", projectRoot, createdAt, folderCounts);
    item.warnings.push("Project is referenced by legacy tasks but absent from the managed project list.");
    items.push(item);
  }
  return items;
}

function createProjectMigrationItem(
  name: string,
  source: "managed-list" | "task-reference",
  projectRoot: string,
  createdAt: string,
  folderCounts: Map<string, number>
): ProjectMigrationItem {
  const folderBase = sanitizeTitleForPath(name);
  const folderKey = `${projectRoot}/${folderBase}`.toLocaleLowerCase();
  const copyNumber = (folderCounts.get(folderKey) || 0) + 1;
  folderCounts.set(folderKey, copyNumber);
  const suffix = copyNumber === 1 ? "" : ` (${copyNumber})`;
  const folderName = `${folderBase.slice(0, Math.max(1, 120 - suffix.length)).trim()}${suffix}`;
  const record = createProjectRecord(name, createdAt);
  return {
    name,
    action: "import",
    reason: "",
    destination: `${projectRoot}/${folderName}`,
    source,
    warnings: [],
    record,
    projectMarkdown: renderProjectMarkdown(record)
  };
}

function skip(legacyId: string, title: string, reason: string, tags: string[] | undefined): MigrationItem {
  return { legacyId, title, action: "skip", reason, destination: "", warnings: [], legacyTags: tags || [] };
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function extractTitle(raw: unknown): string {
  return clean(raw).replace(/^[-*]\s+\[[ xX]\]\s+/, "").replace(/\s+#\S+.*$/, "").trim();
}

function validDate(value: unknown): string {
  const cleanValue = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanValue) ? cleanValue : "";
}

function validTimestamp(value: unknown): string {
  const cleanValue = clean(value);
  if (!cleanValue) return "";
  const date = new Date(cleanValue);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function compareUpdates(left: LegacyUpdate, right: LegacyUpdate): number {
  return clean(left.createdAt || left.date).localeCompare(clean(right.createdAt || right.date));
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

function normalizeProjectKey(value: string): string {
  return normalizeProjectName(value).toLocaleLowerCase();
}
