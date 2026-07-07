import {
  environmentUpdateRequestSchema,
  localEnvironmentProjectSchema,
  localEnvironmentStateSchema,
  localEnvironmentWorktreeBindingSchema,
  localEnvironmentWorktreeBindingSnapshotSchema,
} from "@shared/contracts/environment.ts";
import { describe, expect, it } from "vitest";

function project(overrides: Record<string, unknown> = {}): unknown {
  return {
    cleanupCommand: "pnpm cleanup:worktree",
    env: { NODE_ENV: "development" },
    projectRootPath: "/repo/pier",
    setupCommand: "pnpm setup:worktree",
    updatedAt: 1,
    ...overrides,
  };
}

describe("local environment contracts", () => {
  it("accepts a flat project with setup, cleanup and env", () => {
    expect(localEnvironmentProjectSchema.parse(project())).toEqual({
      cleanupCommand: "pnpm cleanup:worktree",
      copyPatterns: [],
      env: { NODE_ENV: "development" },
      projectRootPath: "/repo/pier",
      setupCommand: "pnpm setup:worktree",
      updatedAt: 1,
    });
  });

  it("rejects legacy fields on project", () => {
    expect(() =>
      localEnvironmentProjectSchema.parse(
        project({ environments: [], selectedEnvironmentId: null })
      )
    ).toThrow();
  });

  it("rejects setup and cleanup longer than 12,000 characters", () => {
    const tooLong = "x".repeat(12_001);
    expect(() =>
      localEnvironmentProjectSchema.parse(project({ setupCommand: tooLong }))
    ).toThrow();
    expect(() =>
      localEnvironmentProjectSchema.parse(project({ cleanupCommand: tooLong }))
    ).toThrow();
  });

  it("rejects env keys that terminal launch env would reject", () => {
    expect(() =>
      localEnvironmentProjectSchema.parse(
        project({ env: { "1NODE_ENV": "development" } })
      )
    ).toThrow();
  });

  it("accepts a binding without environmentId and rejects one with", () => {
    const binding = {
      createdAt: 1,
      projectRootPath: "/repo/pier",
      worktreePath: "/repo/pier.worktree/feature",
    };
    expect(localEnvironmentWorktreeBindingSchema.parse(binding)).toEqual(
      binding
    );
    expect(() =>
      localEnvironmentWorktreeBindingSchema.parse({
        ...binding,
        environmentId: "pier",
      })
    ).toThrow();
  });

  it("accepts a state with a project and a binding", () => {
    const state = {
      projects: [project()],
      version: 1,
      worktreeBindings: [
        {
          createdAt: 1,
          projectRootPath: "/repo/pier",
          worktreePath: "/repo/pier.worktree/feature",
        },
      ],
    };
    const expected = {
      ...state,
      projects: [
        { ...(project() as Record<string, unknown>), copyPatterns: [] },
      ],
    };
    expect(localEnvironmentStateSchema.parse(state)).toEqual(expected);
  });

  it("accepts flattened update payload without environmentId or name", () => {
    const payload = {
      cleanupCommand: "cleanup",
      copyPatterns: [".env*"],
      env: { NODE_ENV: "development" },
      projectRootPath: "/repo/pier",
      setupCommand: "setup",
    };
    expect(environmentUpdateRequestSchema.parse(payload)).toEqual(payload);
    expect(() =>
      environmentUpdateRequestSchema.parse({
        ...payload,
        environmentId: "pier",
      })
    ).toThrow();
    expect(() =>
      environmentUpdateRequestSchema.parse({ ...payload, name: "Pier" })
    ).toThrow();
    // copyPatterns is required on update payload (no default)
    const { copyPatterns: _drop, ...withoutPatterns } = payload;
    expect(() =>
      environmentUpdateRequestSchema.parse(withoutPatterns)
    ).toThrow();
  });

  it("accepts binding snapshot with flattened setup/cleanup/env/copy", () => {
    const snapshot = {
      cleanupCommand: "cleanup",
      copyPatterns: [".env*"],
      env: { NODE_ENV: "development" },
      hasCleanupScript: true,
      projectRootPath: "/repo/pier",
      setupCommand: "setup",
      worktreePath: "/repo/pier.worktree/feature",
    };
    expect(
      localEnvironmentWorktreeBindingSnapshotSchema.parse(snapshot)
    ).toEqual(snapshot);
    expect(() =>
      localEnvironmentWorktreeBindingSnapshotSchema.parse({
        ...snapshot,
        environmentId: "pier",
      })
    ).toThrow();
  });

  it("copyPatterns rejects empty strings, oversized patterns and > 64 entries", () => {
    expect(() =>
      localEnvironmentProjectSchema.parse(project({ copyPatterns: [""] }))
    ).toThrow();
    expect(() =>
      localEnvironmentProjectSchema.parse(
        project({ copyPatterns: ["x".repeat(257)] })
      )
    ).toThrow();
    const tooMany = Array.from({ length: 65 }, (_, i) => `p${i}`);
    expect(() =>
      localEnvironmentProjectSchema.parse(project({ copyPatterns: tooMany }))
    ).toThrow();
  });
});
