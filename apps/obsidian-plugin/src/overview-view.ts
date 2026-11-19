import { Menu, setIcon } from "obsidian";
import { statusLabel, TASK_STATUSES, type TaskStatus } from "@fjg/task-core";
import { groupTasksForKanban } from "./dashboard-model";
import type { IndexedTask } from "./workspace-service";

let nextOverviewGridId = 0;

export function renderOverviewGroups(root: HTMLElement, tasks: IndexedTask[], actions: {
  open: (id: string) => void;
  people: (id: string) => void;
  copyPath: (id: string) => void;
  move: (id: string, status: TaskStatus) => void;
}, selectedId?: string, collapsedStatuses?: Set<TaskStatus>): void {
  const gridId = ++nextOverviewGridId;
  const grid = root.createDiv({ cls: "fjg-overview-grid", attr: { "aria-label": "Objective overview by status" } });
  for (const column of groupTasksForKanban(tasks)) {
    const section = grid.createEl("section", { cls: "fjg-overview-group", attr: { "data-overview-status": column.status, "aria-label": statusLabel(column.status) } });
    const label = statusLabel(column.status);
    const heading = section.createDiv({ cls: collapsedStatuses ? "fjg-overview-heading is-toggleable" : "fjg-overview-heading" });
    const titleHeading = heading.createEl("h3", collapsedStatuses ? {} : { text: label });
    const count = { text: String(column.tasks.length), attr: { "aria-label": `${column.tasks.length} matching objectives` } };
    const bodyId = `fjg-overview-${gridId}-${column.status}`;
    const toggle = collapsedStatuses ? titleHeading.createEl("button", {
      cls: "fjg-overview-toggle", attr: { type: "button", "aria-label": `${label}, ${column.tasks.length} objectives`, "aria-controls": bodyId }
    }) : undefined;
    const icon = toggle?.createSpan({ cls: "fjg-overview-chevron", attr: { "aria-hidden": "true" } });
    if (toggle) {
      toggle.createSpan({ cls: "fjg-overview-toggle-label", text: label });
      toggle.createSpan(count);
    } else {
      heading.createSpan(count);
    }
    section.addEventListener("dragover", event => {
      if (!event.dataTransfer?.types.includes("application/x-fjg-task-id")) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "move"; section.addClass("is-drag-over");
    });
    section.addEventListener("dragleave", event => {
      if (!event.relatedTarget || !section.contains(event.relatedTarget as Node)) section.removeClass("is-drag-over");
    });
    section.addEventListener("drop", event => {
      event.preventDefault(); section.removeClass("is-drag-over");
      const id = event.dataTransfer?.getData("application/x-fjg-task-id");
      if (id) actions.move(id, column.status);
    });
    const body = section.createDiv({ cls: "fjg-overview-body", attr: { id: bodyId } });
    let rendered = false;
    const renderRows = () => {
      if (rendered) return;
      rendered = true;
      if (!column.tasks.length) body.createDiv({ text: "No matching objectives", cls: "fjg-overview-empty" });
      for (const task of column.tasks) {
        const id = task.record.task_id;
        const row = body.createDiv({ cls: "fjg-overview-row", attr: { draggable: "true", "data-task-id": id } });
        row.addEventListener("dragstart", event => {
          if (!event.dataTransfer) return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-fjg-task-id", id);
          row.addClass("is-dragging");
        });
        row.addEventListener("dragend", () => {
          row.removeClass("is-dragging");
          grid.querySelectorAll(".is-drag-over").forEach(el => el.removeClass("is-drag-over"));
        });
        const title = row.createEl("button", { text: task.record.title, cls: "fjg-overview-title", attr: { type: "button", ...(selectedId !== undefined ? { "aria-expanded": String(id === selectedId), "aria-controls": "fjg-overview-details" } : {}) } });
        title.addEventListener("click", () => actions.open(id));
        const more = row.createEl("button", { cls: "fjg-overview-menu", attr: { type: "button", "aria-label": `Options for ${task.record.title}`, "aria-haspopup": "menu" } });
        setIcon(more, "ellipsis");
        more.addEventListener("click", () => {
          const menu = new Menu();
          menu.addItem(item => item.setTitle("Assign People…").setIcon("users").onClick(() => actions.people(id)));
          menu.addItem(item => item.setTitle("Copy vault folder path").setIcon("copy").onClick(() => actions.copyPath(id)));
          menu.addSeparator();
          for (const status of TASK_STATUSES) menu.addItem(item => item.setTitle(statusLabel(status)).setChecked(status === task.record.status).onClick(() => actions.move(id, status)));
          const rect = more.getBoundingClientRect();
          menu.showAtPosition({ x: rect.left, y: rect.bottom });
        });
      }
    };
    const updateDisclosure = () => {
      const expanded = !collapsedStatuses?.has(column.status);
      body.hidden = !expanded;
      toggle?.setAttribute("aria-expanded", String(expanded));
      if (icon) setIcon(icon, expanded ? "chevron-down" : "chevron-right");
      if (expanded) renderRows();
    };
    if (toggle && collapsedStatuses) toggle.addEventListener("click", () => {
      if (!collapsedStatuses.delete(column.status)) collapsedStatuses.add(column.status);
      updateDisclosure();
    });
    updateDisclosure();
  }
}
