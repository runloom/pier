import type { PierCoreServices } from "@main/app-core/command-router-services.ts";
import { admitWorktreeRemove } from "@main/app-core/commands/worktree-remove-admission.ts";
import { describe, expect, it } from "vitest";

function services(partial: {
  agentEntries?: Array<{
    worktreeKey?: string;
    status: string;
  }>;
  taskRuns?: Array<{
    projectRootPath: string;
    status: "pending" | "running" | "stopping" | "succeeded" | "failed";
  }>;
  dirtyFiles?: number;
}): PierCoreServices {
  return {
    agentRuntimeIndex: {
      listMachine: () => ({
        entries: partial.agentEntries ?? [],
      }),
    },
    tasks: {
      runsSnapshot: () => ({
        version: 1,
        runs: Object.fromEntries(
          (partial.taskRuns ?? []).map((run, i) => [
            `run-${i}`,
            {
              runId: `run-${i}`,
              rootTaskId: "t",
              projectRootPath: run.projectRootPath,
              status: run.status,
              startedAt: 0,
              updatedAt: 0,
              mode: "background" as const,
              nodes: {},
            },
          ])
        ),
      }),
    },
    git: {
      getStatus: async () => ({
        files: Array.from({ length: partial.dirtyFiles ?? 0 }, (_, i) => ({
          path: `f${i}`,
        })),
      }),
    },
  } as never;
}

describe("admitWorktreeRemove (W4-S1)", () => {
  it("allows clean worktree with no live agents or tasks", async () => {
    const result = await admitWorktreeRemove(
      services({}),
      "/repo.worktree/feat"
    );
    expect(result).toEqual({ blocked: false });
  });

  it("blocks when agent runtime is active on path", async () => {
    const result = await admitWorktreeRemove(
      services({
        agentEntries: [
          { worktreeKey: "/repo.worktree/feat", status: "running" },
        ],
      }),
      "/repo.worktree/feat"
    );
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.message).toMatch(/agent runtime/u);
    }
  });

  it("blocks when non-terminal task run uses projectRootPath", async () => {
    const result = await admitWorktreeRemove(
      services({
        taskRuns: [
          { projectRootPath: "/repo.worktree/feat", status: "running" },
        ],
      }),
      "/repo.worktree/feat"
    );
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.message).toMatch(/task run/u);
    }
  });

  it("blocks when worktree has uncommitted changes", async () => {
    const result = await admitWorktreeRemove(
      services({ dirtyFiles: 2 }),
      "/repo.worktree/feat"
    );
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.message).toMatch(/uncommitted/u);
    }
  });

  it("fail-closes when tasks snapshot throws", async () => {
    const broken = {
      agentRuntimeIndex: {
        listMachine: () => ({ entries: [] }),
      },
      tasks: {
        runsSnapshot: () => {
          throw new Error("tasks down");
        },
      },
      git: {
        getStatus: async () => ({ files: [] }),
      },
    } as never;
    const result = await admitWorktreeRemove(broken, "/repo.worktree/feat");
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.message).toMatch(/task occupancy/u);
    }
  });
});
