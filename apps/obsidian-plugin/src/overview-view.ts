import { Menu, setIcon } from "obsidian";
import { statusLabel, TASK_STATUSES, type TaskStatus } from "@fjg/task-core";
import { groupTasksForKanban } from "./dashboard-model";
import type { IndexedTask } from "./workspace-service";

export function renderOverviewGroups(root: HTMLElement, tasks: IndexedTask[], actions: {
  open: (id: string) => void;
  people: (id: string) => void;
  move: (id: string, status: TaskStatus) => void;
}): void {
  const grid = root.createDiv({ cls: "fjg-overview-grid", attr: { "aria-label": "Objective overview by status" } });
  for (const column of groupTasksForKanban(tasks)) {
    const section = grid.createEl("section", { cls: "fjg-overview-group", attr: { "data-overview-status": column.status, "aria-label": statusLabel(column.status) } });
    const heading = section.createDiv({ cls: "fjg-overview-heading" });
    heading.createEl("h3", { text: statusLabel(column.status) });
    heading.createSpan({ text: String(column.tasks.length), attr: { "aria-label": `${column.tasks.length} matching objectives` } });
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
    if (!column.tasks.length) section.createDiv({ text: "No matching objectives", cls: "fjg-overview-empty" });
    for (const task of column.tasks) {
      const id = task.record.task_id;
      const row = section.createDiv({ cls: "fjg-overview-row", attr: { draggable: "true", "data-task-id": id } });
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
      const title = row.createEl("button", { text: task.record.title, cls: "fjg-overview-title", attr: { type: "button" } });
      title.addEventListener("click", () => actions.open(id));
      const more = row.createEl("button", { cls: "fjg-overview-menu", attr: { type: "button", "aria-label": `Options for ${task.record.title}`, "aria-haspopup": "menu" } });
      setIcon(more, "ellipsis");
      more.addEventListener("click", () => {
        const menu = new Menu();
        menu.addItem(item => item.setTitle("Assign People…").setIcon("users").onClick(() => actions.people(id)));
        menu.addSeparator();
        for (const status of TASK_STATUSES) menu.addItem(item => item.setTitle(statusLabel(status)).setChecked(status === task.record.status).onClick(() => actions.move(id, status)));
        const rect = more.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom });
      });
    }
  }
}
