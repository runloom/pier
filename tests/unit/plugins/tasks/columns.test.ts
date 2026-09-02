import { describe, expect, it } from "vitest";
import {
  columnIsReadonly,
  heuristicColumnId,
  isHeuristicLaneSet,
  kindFromJiraCategory,
  kindFromLinearType,
  linkedPullRequestsAllowDone,
} from "../../../../packages/plugin-tasks/src/shared/columns.ts";

describe("task column semantics", () => {
  it("maps unassigned open to todo, assigned open to in progress, closed to done", () => {
    expect(heuristicColumnId({ closed: false })).toBe("todo");
    expect(heuristicColumnId({ assigneeLogin: "ada", closed: false })).toBe(
      "inProgress"
    );
    expect(heuristicColumnId({ assigneeLogin: "ada", closed: true })).toBe(
      "done"
    );
  });

  it("keeps done read-only until confirm or every linked PR is merged", () => {
    expect(columnIsReadonly("todo")).toBe(false);
    expect(columnIsReadonly("done")).toBe(true);
    expect(columnIsReadonly("done", { confirm: true })).toBe(false);
    expect(
      columnIsReadonly("done", {
        linkedPRs: [{ merged: true }, { merged: true }],
      })
    ).toBe(false);
    expect(
      columnIsReadonly("done", {
        linkedPRs: [{ merged: true }, { merged: false }],
      })
    ).toBe(true);
  });

  it("detects the collapsed three-lane Linear/Jira cache shape", () => {
    expect(
      isHeuristicLaneSet([{ id: "todo" }, { id: "inProgress" }, { id: "done" }])
    ).toBe(true);
    expect(
      isHeuristicLaneSet([{ id: "state-todo" }, { id: "state-verify" }])
    ).toBe(false);
  });

  it("maps Linear and Jira source states onto icon kinds without merging canceled into done", () => {
    expect(kindFromLinearType("unstarted")).toBe("todo");
    expect(kindFromLinearType("started")).toBe("inProgress");
    expect(kindFromLinearType("completed")).toBe("done");
    expect(kindFromLinearType("canceled")).toBe("canceled");
    expect(kindFromJiraCategory("new")).toBe("todo");
    expect(kindFromJiraCategory("indeterminate")).toBe("inProgress");
    expect(kindFromJiraCategory("done")).toBe("done");
  });

  it("requires every linked PR to be merged before done is writable", () => {
    expect(linkedPullRequestsAllowDone([])).toBe(false);
    expect(linkedPullRequestsAllowDone([{ merged: true }])).toBe(true);
  });
});
