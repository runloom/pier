import { describe, expect, it } from "vitest";
import { dagFromBoard } from "../../../../packages/plugin-tasks/src/shared/dag.ts";
import type {
  TaskBoardSnapshot,
  TaskCard,
} from "../../../../packages/plugin-tasks/src/shared/types.ts";

function card(key: string, blockers: readonly string[] = []): TaskCard {
  return {
    assignee: null,
    blockers: blockers.map((blocker) => ({
      key: blocker,
      repo: "acme/app",
      title: blocker,
      url: "",
    })),
    externalBlockedByCount: 0,
    externalBlockers: [],
    key,
    labels: [],
    linkedPRs: [],
    milestone: null,
    number: 1,
    openBlockedByCount: blockers.length,
    repo: "acme/app",
    title: key,
    url: `https://example.test/${key}`,
  };
}

function board(): TaskBoardSnapshot {
  return {
    canWrite: true,
    columnMapping: "heuristic",
    columns: [
      {
        id: "todo",
        items: [card("acme/app#2", ["acme/app#1"]), card("acme/app#3")],
        readonly: false,
        title: "Todo",
      },
      {
        id: "inProgress",
        items: [card("acme/app#1")],
        readonly: false,
        title: "In Progress",
      },
      { id: "done", items: [], readonly: true, title: "Done" },
    ],
    cycleKeys: ["acme/app#9"],
    fetchedAt: 42,
    generation: 7,
    hasCycle: true,
    params: { repo: "acme/app" },
    schemaVersion: 1,
    truncated: false,
  };
}

describe("dagFromBoard", () => {
  it("derives nodes and deduplicated edges from card blockers", () => {
    const dag = dagFromBoard(board());
    expect(dag.nodes.map((node) => node.key)).toEqual([
      "acme/app#2",
      "acme/app#3",
      "acme/app#1",
    ]);
    expect(dag.edges).toEqual([{ from: "acme/app#1", to: "acme/app#2" }]);
  });

  it("carries scope, cycle facts, and board generation through", () => {
    const dag = dagFromBoard(board());
    expect(dag.params).toEqual({ repo: "acme/app" });
    expect(dag.hasCycle).toBe(true);
    expect(dag.cycleKeys).toEqual(["acme/app#9"]);
    expect(dag.generation).toBe(7);
    expect(dag.fetchedAt).toBe(42);
    expect(dag.schemaVersion).toBe(1);
  });
});
