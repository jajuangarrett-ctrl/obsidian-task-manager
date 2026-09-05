import { describe, expect, it } from "vitest";
import {
  isProjectTag,
  projectNameFromTag,
  projectNameFromTags,
  projectTagForName,
  syncProjectTag
} from "./project-tags";

describe("project tags", () => {
  it("creates queryable nested tags while preserving readable capitalization", () => {
    expect(projectTagForName("Basic Needs Expansion")).toBe("project/Basic_Needs_Expansion");
    expect(projectTagForName("CW/ISSP Recruitment")).toBe("project/CW_ISSP_Recruitment");
  });

  it("replaces only project tags and leaves other task tags intact", () => {
    expect(syncProjectTag(["task", "follow-up", "project/Old_Project"], "Basic Needs Expansion"))
      .toEqual(["task", "follow-up", "project/Basic_Needs_Expansion"]);
    expect(syncProjectTag(["task", "project/Old_Project"], "")).toEqual(["task"]);
  });

  it("reads project names back from tags", () => {
    expect(isProjectTag("PROJECT/Basic_Needs_Expansion")).toBe(true);
    expect(projectNameFromTag("project/Basic_Needs_Expansion")).toBe("Basic Needs Expansion");
    expect(projectNameFromTags(["task", "project/Basic_Needs_Expansion"])).toBe("Basic Needs Expansion");
  });
});
