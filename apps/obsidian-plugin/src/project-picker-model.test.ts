import { describe, expect, it } from "vitest";
import {
  filterProjectPickerOptions,
  projectPickerCreationError
} from "./project-picker-model";

describe("project picker model", () => {
  const projects = ["Basic Needs Expansion", "CalWORKs Planning", "Student Success"];

  it("filters project options by a typed query", () => {
    expect(filterProjectPickerOptions(projects, "basic")).toEqual(["Basic Needs Expansion"]);
    expect(filterProjectPickerOptions(projects, "work plan")).toEqual(["CalWORKs Planning"]);
  });

  it("reports no matches and guards duplicate or empty inline creation", () => {
    expect(filterProjectPickerOptions(projects, "missing")).toEqual([]);
    expect(projectPickerCreationError(projects, "  BASIC   needs-expansion ")).toBe(
      "Project already exists: BASIC needs-expansion"
    );
    expect(projectPickerCreationError(projects, " ")).toBe("Enter a project name to create it.");
    expect(projectPickerCreationError(projects, "New Initiative")).toBe("");
  });
});
