import { describe, expect, it } from "vitest";
import { createBoardPoller } from "../../../../packages/plugin-tasks/src/main/poller.ts";
import type { TrackerProvider } from "../../../../packages/plugin-tasks/src/main/providers/types.ts";
import { SCHEMA_VERSION } from "../../../../packages/plugin-tasks/src/shared/constants.ts";
import type {
  TaskBoardParams,
  TaskBoardSnapshot,
} from "../../../../packages/plugin-tasks/src/shared/types.ts";

function emptySnapshot(
  params: TaskBoardParams
): Omit<TaskBoardSnapshot, "generation"> {
  return {
    canWrite: false,
    columnMapping: "heuristic",
    columns: [
      { id: "todo", items: [], readonly: false, title: "Todo" },
      { id: "inProgress", items: [], readonly: false, title: "In Progress" },
      { id: "done", items: [], readonly: true, title: "Done" },
    ],
    cycleKeys: [],
    fetchedAt: 1,
    hasCycle: false,
    params,
    schemaVersion: SCHEMA_VERSION,
    truncated: false,
  };
}

function stubProvider(
  fetchBoard: TrackerProvider["fetchBoard"]
): TrackerProvider {
  return {
    createIssue: async () => {
      throw new Error("unused");
    },
    createStandardLabels: async () => undefined,
    fetchBoard,
    setAssignees: async () => {
      throw new Error("unused");
    },
    setClosed: async () => {
      throw new Error("unused");
    },
    viewerLogin: async () => null,
  };
}

describe("board poller", () => {
  it("does not serve a team-wide cache to a Linear project snapshot", async () => {
    const teamParams = { provider: "linear" as const, repo: "FL" };
    const projectParams = { ...teamParams, projectId: "proj-1" };
    const cached: TaskBoardSnapshot = {
      ...emptySnapshot(teamParams),
      generation: 1,
    };
    let fetched: TaskBoardParams | undefined;
    const poller = createBoardPoller({
      cache: {
        get: () => cached,
        init: async () => undefined,
        set: async () => undefined,
      },
      emitBoard: () => undefined,
      emitDag: () => undefined,
      logger: { warn: () => undefined },
      provider: stubProvider(async (params) => {
        fetched = params;
        return emptySnapshot(params);
      }),
    });
    const snapshot = await poller.snapshotBoard(projectParams);
    expect(fetched).toEqual(projectParams);
    expect(snapshot.params.projectId).toBe("proj-1");
  });

  it("does not paint a Linear cache that still has the three heuristic lanes", async () => {
    const params = { provider: "linear" as const, repo: "FL" };
    const cached: TaskBoardSnapshot = {
      ...emptySnapshot(params),
      generation: 1,
    };
    let fetched = false;
    const poller = createBoardPoller({
      cache: {
        get: () => cached,
        init: async () => undefined,
        set: async () => undefined,
      },
      emitBoard: () => undefined,
      emitDag: () => undefined,
      logger: { warn: () => undefined },
      provider: stubProvider(async () => {
        fetched = true;
        return {
          ...emptySnapshot(params),
          columns: [
            {
              id: "state-todo",
              items: [],
              kind: "todo",
              readonly: false,
              title: "任务",
            },
          ],
        };
      }),
    });
    const snapshot = await poller.snapshotBoard(params);
    expect(fetched).toBe(true);
    expect(snapshot.columns.map((column) => column.title)).toEqual(["任务"]);
  });
});
