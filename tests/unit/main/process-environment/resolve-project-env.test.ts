import { resolveProjectEnvForSpawn } from "@main/services/process-environment/resolve-project-env.ts";
import { describe, expect, it, vi } from "vitest";

describe("resolveProjectEnvForSpawn", () => {
  it("prefers worktree binding env for cwd", async () => {
    const localEnvironments = {
      resolveForWorktree: vi.fn(async () => ({
        project: {
          cleanupCommand: "",
          copyPatterns: [],
          env: { FROM_WT: "1" },
          kind: "project" as const,
          projectRootPath: "/proj",
          setupCommand: "",
          updatedAt: 1,
        },
        projectRootPath: "/proj",
      })),
      resolveProject: vi.fn(async () => ({
        cleanupCommand: "",
        copyPatterns: [],
        env: { FROM_PROJECT: "1" },
        kind: "project" as const,
        projectRootPath: "/proj",
        setupCommand: "",
        updatedAt: 1,
      })),
    };

    await expect(
      resolveProjectEnvForSpawn({
        cwd: "/wt",
        localEnvironments,
        projectRootPath: "/proj",
      })
    ).resolves.toEqual({ FROM_WT: "1" });
    expect(localEnvironments.resolveProject).not.toHaveBeenCalled();
  });

  it("falls back to resolveProject when no worktree binding", async () => {
    const localEnvironments = {
      resolveForWorktree: vi.fn(async () => null),
      resolveProject: vi.fn(async () => ({
        cleanupCommand: "",
        copyPatterns: [],
        env: { FROM_PROJECT: "yes" },
        kind: "project" as const,
        projectRootPath: "/proj",
        setupCommand: "",
        updatedAt: 1,
      })),
    };

    await expect(
      resolveProjectEnvForSpawn({
        cwd: "/loose",
        localEnvironments,
        projectRootPath: "/proj",
      })
    ).resolves.toEqual({ FROM_PROJECT: "yes" });
  });

  it("returns undefined when neither path resolves", async () => {
    const localEnvironments = {
      resolveForWorktree: vi.fn(async () => null),
      resolveProject: vi.fn(async () => null),
    };

    await expect(
      resolveProjectEnvForSpawn({
        cwd: "/x",
        localEnvironments,
        projectRootPath: "/y",
      })
    ).resolves.toBeUndefined();
  });

  it("ignores empty env objects", async () => {
    const localEnvironments = {
      resolveForWorktree: vi.fn(async () => ({
        project: {
          cleanupCommand: "",
          copyPatterns: [],
          env: {},
          kind: "project" as const,
          projectRootPath: "/proj",
          setupCommand: "",
          updatedAt: 1,
        },
        projectRootPath: "/proj",
      })),
      resolveProject: vi.fn(async () => null),
    };

    await expect(
      resolveProjectEnvForSpawn({ cwd: "/wt", localEnvironments })
    ).resolves.toBeUndefined();
  });
});
