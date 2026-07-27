import { createTaskRecentLauncher } from "@main/services/tasks/task-recent-launcher.ts";
import type {
  TaskCandidate,
  TaskLaunchPlan,
  TaskRecentEntry,
  TaskRecentState,
} from "@shared/contracts/tasks.ts";
import { describe, expect, it } from "vitest";

const NOW = 1_700_000_000_000;
const COMMON = "/repo/main/.git";

function launch(
  taskId: string,
  cwd: string,
  overrides: Partial<TaskLaunchPlan> = {}
): TaskLaunchPlan {
  const label = taskId.replace(/^package-script:/, "");
  return {
    command: `pnpm run ${label}`,
    cwd,
    focus: true,
    label,
    presentation: {},
    projectRootPath: cwd,
    rawCommand: `pnpm run ${label}`,
    source: "package-script",
    tab: { title: label },
    taskId,
    ...overrides,
  };
}

function packageScript(name: string, cwd: string): TaskCandidate {
  return {
    commandSpec: { command: `pnpm run ${name}`, kind: "shell" },
    concurrencyPolicy: "dedupe",
    cwd,
    id: `package-script:${name}`,
    label: name,
    source: "package-script",
  };
}

describe("createTaskRecentLauncher package-script sharing", () => {
  it("merges launches from different worktree cwds under one gitCommonDir", async () => {
    let stored: TaskRecentState = { entries: [], version: 1 };
    let clock = NOW;
    const launcher = createTaskRecentLauncher({
      now: () => clock,
      readRecentState: async () => stored,
      resolveGitCommonDir: async () => COMMON,
      writeRecentState: async (state) => {
        stored = state;
      },
    });

    await launcher.recordLaunch(launch("package-script:dev", "/repo/main"));
    clock += 1000;
    await launcher.recordLaunch(
      launch("package-script:dev", "/repo/worktrees/feature")
    );

    expect(stored.entries).toHaveLength(1);
    expect(stored.entries[0]).toMatchObject({
      cwd: "/repo/worktrees/feature",
      gitCommonDir: COMMON,
      taskId: "package-script:dev",
      useCount: 2,
    });
  });

  it("sorts worktree package-scripts using history recorded on another cwd", async () => {
    const main = "/repo/main";
    const worktree = "/repo/worktrees/feature";
    const stored: TaskRecentState = {
      version: 1,
      entries: [
        {
          command: "pnpm run typecheck",
          cwd: main,
          gitCommonDir: COMMON,
          lastUsedAt: NOW,
          label: "typecheck",
          source: "history",
          taskId: "package-script:typecheck",
          useCount: 8,
        },
        {
          command: "pnpm run lint",
          cwd: main,
          gitCommonDir: COMMON,
          lastUsedAt: NOW - 1000,
          label: "lint",
          source: "history",
          taskId: "package-script:lint",
          useCount: 2,
        },
      ],
    };
    const launcher = createTaskRecentLauncher({
      now: () => NOW,
      readRecentState: async () => stored,
      resolveGitCommonDir: async () => COMMON,
      writeRecentState: async () => undefined,
    });
    await launcher.ensureLoaded();
    const ranked = await launcher.sort([
      packageScript("lint", worktree),
      packageScript("dev", worktree),
      packageScript("typecheck", worktree),
    ]);
    expect(ranked.map((task) => task.label)).toEqual([
      "typecheck",
      "lint",
      "dev",
    ]);
  });

  it("enriches legacy entries missing gitCommonDir on load and collapses peers", async () => {
    let stored: TaskRecentState = {
      version: 1,
      entries: [
        {
          command: "pnpm run dev",
          cwd: "/repo/main",
          lastUsedAt: NOW - 2000,
          label: "dev",
          source: "history",
          taskId: "package-script:dev",
          useCount: 4,
        },
        {
          command: "pnpm run dev",
          cwd: "/repo/worktrees/feature",
          lastUsedAt: NOW,
          label: "dev",
          source: "history",
          taskId: "package-script:dev",
          useCount: 1,
        },
      ] satisfies TaskRecentEntry[],
    };
    const launcher = createTaskRecentLauncher({
      now: () => NOW,
      readRecentState: async () => stored,
      resolveGitCommonDir: async () => COMMON,
      writeRecentState: async (state) => {
        stored = state;
      },
    });
    await launcher.ensureLoaded();
    expect(stored.entries).toHaveLength(1);
    expect(stored.entries[0]).toMatchObject({
      gitCommonDir: COMMON,
      taskId: "package-script:dev",
      useCount: 5,
      cwd: "/repo/worktrees/feature",
    });
  });

  it("does not merge non-package-script tasks across cwds", async () => {
    let stored: TaskRecentState = { entries: [], version: 1 };
    const launcher = createTaskRecentLauncher({
      now: () => NOW,
      readRecentState: async () => stored,
      resolveGitCommonDir: async () => COMMON,
      writeRecentState: async (state) => {
        stored = state;
      },
    });
    await launcher.recordLaunch(
      launch("make:build", "/repo/main", {
        source: "make",
        command: "make build",
        rawCommand: "make build",
        label: "build",
      })
    );
    await launcher.recordLaunch(
      launch("make:build", "/repo/worktrees/feature", {
        source: "make",
        command: "make build",
        rawCommand: "make build",
        label: "build",
      })
    );
    expect(stored.entries).toHaveLength(2);
  });

  it("does not let migration write clobber a concurrent recordLaunch", async () => {
    let stored: TaskRecentState = {
      version: 1,
      entries: [
        {
          command: "pnpm run lint",
          cwd: "/repo/main",
          lastUsedAt: NOW - 1000,
          label: "lint",
          source: "history",
          taskId: "package-script:lint",
          useCount: 2,
        },
      ],
    };
    let migrationWriteStarted!: () => void;
    const migrationWriteStartedP = new Promise<void>((resolve) => {
      migrationWriteStarted = resolve;
    });
    let allowMigrationWrite!: () => void;
    const allowMigrationWriteP = new Promise<void>((resolve) => {
      allowMigrationWrite = resolve;
    });
    let writeCount = 0;
    const launcher = createTaskRecentLauncher({
      now: () => NOW,
      readRecentState: async () => stored,
      resolveGitCommonDir: async () => COMMON,
      writeRecentState: async (state) => {
        writeCount += 1;
        if (writeCount === 1) {
          migrationWriteStarted();
          await allowMigrationWriteP;
        }
        stored = {
          entries: state.entries.map((entry) => ({ ...entry })),
          version: state.version,
        };
      },
    });

    const loadP = launcher.ensureLoaded();
    await migrationWriteStartedP;
    const launchP = launcher.recordLaunch(
      launch("package-script:dev", "/repo/worktrees/feature")
    );
    // 给 recordLaunch 机会排队（不应在迁移完成前写盘覆盖）。
    await Promise.resolve();
    allowMigrationWrite();
    await Promise.all([loadP, launchP]);

    expect(
      stored.entries.some((entry) => entry.taskId === "package-script:dev")
    ).toBe(true);
    const dev = stored.entries.find(
      (entry) => entry.taskId === "package-script:dev"
    );
    expect(dev).toMatchObject({
      useCount: 1,
      gitCommonDir: COMMON,
      cwd: "/repo/worktrees/feature",
    });
    // lint 条目应被 enrich 保留，而不是被迁移写盖掉 launch 后丢失 dev
    expect(
      stored.entries.some((entry) => entry.taskId === "package-script:lint")
    ).toBe(true);
  });

  it("serializes concurrent recordLaunch so useCount increments correctly", async () => {
    let stored: TaskRecentState = { entries: [], version: 1 };
    const gitWaiters: Array<(value: string) => void> = [];
    const launcher = createTaskRecentLauncher({
      now: () => NOW,
      readRecentState: async () => stored,
      resolveGitCommonDir: () =>
        new Promise<string>((resolve) => {
          gitWaiters.push(resolve);
        }),
      writeRecentState: async (state) => {
        stored = {
          entries: state.entries.map((entry) => ({ ...entry })),
          version: state.version,
        };
      },
    });

    const first = launcher.recordLaunch(
      launch("package-script:dev", "/repo/main")
    );
    const second = launcher.recordLaunch(
      launch("package-script:dev", "/repo/worktrees/feature")
    );

    // 等两边都卡在 resolveGitCommonDir，制造「同时观察 priorCount」窗口
    for (let i = 0; i < 50 && gitWaiters.length < 2; i += 1) {
      await Promise.resolve();
    }
    expect(gitWaiters.length).toBe(2);
    for (const resolve of gitWaiters) {
      resolve(COMMON);
    }
    await Promise.all([first, second]);

    expect(stored.entries).toHaveLength(1);
    expect(stored.entries[0]).toMatchObject({
      taskId: "package-script:dev",
      useCount: 2,
      gitCommonDir: COMMON,
    });
  });

  it("does not permanently cache failed gitCommonDir resolution", async () => {
    let stored: TaskRecentState = { entries: [], version: 1 };
    let calls = 0;
    const launcher = createTaskRecentLauncher({
      now: () => NOW,
      readRecentState: async () => stored,
      resolveGitCommonDir: async () => {
        calls += 1;
        return calls === 1 ? null : COMMON;
      },
      writeRecentState: async (state) => {
        stored = state;
      },
    });

    await launcher.recordLaunch(launch("package-script:dev", "/repo/main"));
    expect(stored.entries[0]?.gitCommonDir).toBeUndefined();
    expect(calls).toBe(1);

    // 同 cwd 再跑：null 未入缓存，第二次 resolve 成功并回填 gitCommonDir
    await launcher.recordLaunch(launch("package-script:dev", "/repo/main"));
    expect(stored.entries).toHaveLength(1);
    expect(stored.entries[0]).toMatchObject({
      gitCommonDir: COMMON,
      useCount: 2,
    });
    expect(calls).toBe(2);
  });
});
