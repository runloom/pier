import {
  collapseSharedPackageScriptEntries,
  recentPackageScriptKey,
  sameRecentIdentity,
  sortTasksByRecentUse,
} from "@main/services/tasks/recent-ranking.ts";
import type {
  TaskCandidate,
  TaskRecentEntry,
} from "@shared/contracts/tasks.ts";
import { describe, expect, it } from "vitest";

const NOW = 1_700_000_000_000;

function packageScript(
  name: string,
  cwd: string,
  overrides: Partial<TaskCandidate> = {}
): TaskCandidate {
  return {
    commandSpec: { command: `pnpm run ${name}`, kind: "shell" },
    concurrencyPolicy: "dedupe",
    cwd,
    id: `package-script:${name}`,
    label: name,
    source: "package-script",
    ...overrides,
  };
}

function recentPackage(
  name: string,
  cwd: string,
  opts: {
    gitCommonDir?: string;
    lastUsedAt?: number;
    useCount?: number;
  } = {}
): TaskRecentEntry {
  return {
    command: `pnpm run ${name}`,
    cwd,
    label: name,
    source: "history",
    taskId: `package-script:${name}`,
    ...(opts.gitCommonDir ? { gitCommonDir: opts.gitCommonDir } : {}),
    ...(opts.lastUsedAt == null ? {} : { lastUsedAt: opts.lastUsedAt }),
    ...(opts.useCount == null ? {} : { useCount: opts.useCount }),
  };
}

describe("sortTasksByRecentUse package-script gitCommonDir sharing", () => {
  it("shares frecency across worktree cwds with the same gitCommonDir", () => {
    const main = "/repo/main";
    const worktree = "/repo/worktrees/feature";
    const common = "/repo/main/.git";
    const tasks = [
      packageScript("lint", worktree),
      packageScript("dev", worktree),
      packageScript("typecheck", worktree),
    ];
    // 主仓高频 dev；worktree cwd 上无任何记录
    const entries = [
      recentPackage("dev", main, {
        gitCommonDir: common,
        lastUsedAt: NOW,
        useCount: 10,
      }),
      recentPackage("lint", main, {
        gitCommonDir: common,
        lastUsedAt: NOW - 1000,
        useCount: 2,
      }),
    ];
    const ranked = sortTasksByRecentUse(tasks, entries, NOW, {
      gitCommonDirByCwd: new Map([[worktree, common]]),
    });
    expect(ranked.map((task) => task.label)).toEqual([
      "dev",
      "lint",
      "typecheck",
    ]);
  });

  it("does not share frecency across different gitCommonDir", () => {
    const cwdA = "/repo-a";
    const cwdB = "/repo-b";
    const tasks = [packageScript("lint", cwdB), packageScript("dev", cwdB)];
    const entries = [
      recentPackage("dev", cwdA, {
        gitCommonDir: "/repo-a/.git",
        lastUsedAt: NOW,
        useCount: 50,
      }),
    ];
    const ranked = sortTasksByRecentUse(tasks, entries, NOW, {
      gitCommonDirByCwd: new Map([[cwdB, "/repo-b/.git"]]),
    });
    // 无匹配分 → 保持原序
    expect(ranked.map((task) => task.label)).toEqual(["lint", "dev"]);
  });

  it("still matches legacy cwd keys when gitCommonDir is missing on entry", () => {
    const cwd = "/repo/main";
    const tasks = [packageScript("lint", cwd), packageScript("dev", cwd)];
    const entries = [
      recentPackage("dev", cwd, {
        lastUsedAt: NOW,
        useCount: 3,
      }),
    ];
    const ranked = sortTasksByRecentUse(tasks, entries, NOW, {
      gitCommonDirByCwd: new Map([[cwd, "/repo/main/.git"]]),
    });
    expect(ranked.map((task) => task.label)).toEqual(["dev", "lint"]);
  });

  it("does not promote package-script scores onto non-package sources", () => {
    const cwd = "/repo";
    const common = "/repo/.git";
    const tasks: TaskCandidate[] = [
      {
        commandSpec: { command: "make build", kind: "shell" },
        concurrencyPolicy: "dedupe",
        cwd,
        id: "make:build",
        label: "build",
        source: "make",
      },
      packageScript("dev", cwd),
    ];
    const entries = [
      recentPackage("dev", cwd, {
        gitCommonDir: common,
        lastUsedAt: NOW,
        useCount: 9,
      }),
    ];
    const ranked = sortTasksByRecentUse(tasks, entries, NOW, {
      gitCommonDirByCwd: new Map([[cwd, common]]),
    });
    expect(ranked[0]?.source).toBe("package-script");
    expect(ranked[0]?.label).toBe("dev");
  });
});

describe("sameRecentIdentity", () => {
  it("treats same package-script + gitCommonDir as one identity across cwd", () => {
    expect(
      sameRecentIdentity(
        {
          command: "pnpm run dev",
          cwd: "/a",
          gitCommonDir: "/repo/.git",
          taskId: "package-script:dev",
        },
        {
          command: "pnpm run dev",
          cwd: "/b",
          gitCommonDir: "/repo/.git",
          taskId: "package-script:dev",
        }
      )
    ).toBe(true);
  });

  it("keeps different cwds separate without shared gitCommonDir", () => {
    expect(
      sameRecentIdentity(
        {
          command: "pnpm run dev",
          cwd: "/a",
          taskId: "package-script:dev",
        },
        {
          command: "pnpm run dev",
          cwd: "/b",
          taskId: "package-script:dev",
        }
      )
    ).toBe(false);
  });
});

describe("collapseSharedPackageScriptEntries", () => {
  it("sums useCount and keeps the newest cwd", () => {
    const collapsed = collapseSharedPackageScriptEntries([
      recentPackage("dev", "/worktree-a", {
        gitCommonDir: "/repo/.git",
        lastUsedAt: NOW - 5000,
        useCount: 3,
      }),
      recentPackage("dev", "/worktree-b", {
        gitCommonDir: "/repo/.git",
        lastUsedAt: NOW,
        useCount: 2,
      }),
      recentPackage("lint", "/worktree-a", {
        gitCommonDir: "/repo/.git",
        lastUsedAt: NOW,
        useCount: 1,
      }),
    ]);
    expect(collapsed).toHaveLength(2);
    const dev = collapsed.find((entry) => entry.label === "dev");
    expect(dev).toMatchObject({
      cwd: "/worktree-b",
      useCount: 5,
      lastUsedAt: NOW,
      gitCommonDir: "/repo/.git",
    });
  });
});

describe("recentPackageScriptKey", () => {
  it("namespaces package keys away from cwd task keys", () => {
    expect(recentPackageScriptKey("/repo/.git", "package-script:dev")).toBe(
      "pkg\0/repo/.git\0package-script:dev"
    );
  });
});
