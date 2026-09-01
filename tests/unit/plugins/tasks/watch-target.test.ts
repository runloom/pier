import { describe, expect, it } from "vitest";
import { dagWatchTarget } from "../../../../packages/plugin-tasks/applets/task-dag/hooks.ts";
import {
  boardSnapshotMatches,
  boardWatchTarget,
  resolveBoardView,
  type TaskBoardModel,
} from "../../../../packages/plugin-tasks/applets/tracker-board/hooks.ts";

describe("task applet watch targets", () => {
  it("includes the tracker provider in the board query", () => {
    expect(
      boardWatchTarget({
        provider: "linear",
        repo: "ENG",
      })
    ).toBe("plugin:pier.tasks/board?repo=ENG&provider=linear");
    expect(
      dagWatchTarget({
        provider: "jira",
        projectId: "100",
        repo: "PROJ",
      })
    ).toBe("plugin:pier.tasks/dag?repo=PROJ&provider=jira&projectId=100");
  });

  it("uses a sentinel repo when the canvas omitted props", () => {
    expect(boardWatchTarget({})).toBe("plugin:pier.tasks/board?repo=-");
  });

  it("does not treat a placeholder or collapsed Linear cache as the live board", () => {
    const placeholder = {
      canWrite: false,
      columnMapping: "heuristic" as const,
      columns: [
        { id: "todo", items: [], title: "Todo" },
        { id: "inProgress", items: [], title: "In Progress" },
        { id: "done", items: [], title: "Done" },
      ],
      fetchedAt: 0,
      generation: 0,
      params: { provider: "linear" as const, repo: "-" },
    };
    expect(
      boardSnapshotMatches(placeholder, { provider: "linear", repo: "-" })
    ).toBe(false);
    expect(
      boardSnapshotMatches(
        {
          ...placeholder,
          fetchedAt: 1,
          params: { provider: "linear" as const, repo: "FL" },
        },
        { provider: "linear", repo: "FL" }
      )
    ).toBe(false);
  });

  it("ignores a board snapshot from another tracker source", () => {
    const board = {
      canWrite: true,
      columnMapping: "heuristic" as const,
      columns: [],
      fetchedAt: 1,
      generation: 1,
      params: { provider: "github" as const, repo: "acme/app" },
    };
    expect(
      boardSnapshotMatches(board, { provider: "github", repo: "acme/app" })
    ).toBe(true);
    expect(
      boardSnapshotMatches(board, { provider: "linear", repo: "ENG" })
    ).toBe(false);
    expect(
      boardSnapshotMatches(
        {
          ...board,
          params: {
            projectId: "proj-1",
            provider: "linear",
            repo: "ENG",
          },
        },
        { projectId: "proj-1", provider: "linear", repo: "ENG" }
      )
    ).toBe(true);
    expect(
      boardSnapshotMatches(
        {
          ...board,
          params: {
            projectId: "proj-1",
            provider: "linear",
            repo: "ENG",
          },
        },
        { provider: "linear", repo: "ENG" }
      )
    ).toBe(false);
  });

  it("keeps an optimistic move until the tracker snapshot matches columns", () => {
    const card = {
      assignee: null,
      key: "FL-1",
      linkedPRs: [] as const,
      openBlockedByCount: 0,
      title: "Ship",
      url: "https://linear.app/fl-1",
    };
    const todo: TaskBoardModel = {
      canWrite: true,
      columnMapping: "project",
      columns: [
        { id: "todo", items: [card], readonly: false, title: "Todo" },
        { id: "inProgress", items: [], readonly: false, title: "In Progress" },
        { id: "done", items: [], readonly: true, title: "Done" },
      ],
      fetchedAt: 1,
      generation: 1,
    };
    const moved: TaskBoardModel = {
      ...todo,
      columns: [
        { id: "todo", items: [], readonly: false, title: "Todo" },
        {
          id: "inProgress",
          items: [card],
          readonly: false,
          title: "In Progress",
        },
        { id: "done", items: [], readonly: true, title: "Done" },
      ],
      generation: 2,
    };
    const stale: TaskBoardModel = { ...todo, generation: 3 };
    expect(
      resolveBoardView({
        now: 1,
        optimistic: moved,
        pendingUntil: 10_000,
        remote: stale,
      })
    ).toBe(moved);
    expect(
      resolveBoardView({
        now: 1,
        optimistic: moved,
        pendingUntil: 10_000,
        remote: moved,
      })
    ).toBe(moved);
    expect(
      resolveBoardView({
        now: 20_000,
        optimistic: moved,
        pendingUntil: 10_000,
        remote: stale,
      })
    ).toBe(stale);
  });
});
