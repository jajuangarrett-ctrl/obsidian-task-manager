import { describe, expect, it } from "vitest";
import {
  filterTaskRelocationDestinations,
  isTaskRelocationBundlePath,
  isTaskRelocationDestination,
  isTaskRelocationPath,
  normalizeTaskRelocationDestination,
  taskRelocationCollectionName
} from "./task-relocation";

describe("task relocation paths", () => {
  it("accepts only folders below Programs or Areas", () => {
    expect(normalizeTaskRelocationDestination("02 Programs/CalWORKs/Operations"))
      .toBe("02 Programs/CalWORKs/Operations");
    expect(isTaskRelocationDestination("03 Areas/Career")).toBe(true);
    expect(isTaskRelocationDestination("02 Programs")).toBe(false);
    expect(isTaskRelocationDestination("08 Tasks/Projects/CalWORKs")).toBe(false);
  });

  it("recognizes relocated task records without accepting arbitrary notes", () => {
    expect(isTaskRelocationPath("02 Programs/CalWORKs/Tasks/Prepare report/task.md")).toBe(true);
    expect(isTaskRelocationPath("02 Programs/CalWORKs/Prepare report/task.md")).toBe(true);
    expect(isTaskRelocationBundlePath("02 Programs/CalWORKs/Prepare report/task.md")).toBe(true);
    expect(isTaskRelocationBundlePath("02 Programs/CalWORKs/Tasks/Prepare report/task.md")).toBe(false);
    expect(isTaskRelocationPath("03 Areas/Career/Notes/Prepare report.md")).toBe(false);
    expect(isTaskRelocationPath("08 Tasks/Inbox/Tasks/Prepare report/task.md")).toBe(false);
  });

  it("filters hidden and duplicate destination folders", () => {
    expect(filterTaskRelocationDestinations([
      "02 Programs/CalWORKs",
      "02 Programs/CalWORKs",
      "02 Programs/CalWORKs/.claude",
      "03 Areas/Career",
      "08 Tasks/Inbox"
    ])).toEqual([
      "02 Programs/CalWORKs",
      "03 Areas/Career"
    ]);
  });

  it("names each relocation collection after its destination", () => {
    expect(taskRelocationCollectionName("02 Programs/Basic-Needs")).toBe("Basic Needs Tasks");
    expect(taskRelocationCollectionName("03 Areas/Career")).toBe("Career Tasks");
    expect(taskRelocationCollectionName("03 Areas/Operations Tasks")).toBe("Operations Tasks");
  });
});
