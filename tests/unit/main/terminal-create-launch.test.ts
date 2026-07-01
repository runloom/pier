import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  nativeLaunchOptions,
  resolveCreateTerminalLaunch,
} from "@main/ipc/terminal-create-launch.ts";
import { terminalLaunchRegistry } from "@main/state/terminal-launch-state.ts";
import type { TerminalPanelSession } from "@main/state/terminal-session-state.ts";
import type { CreateTerminalArgs } from "@shared/contracts/terminal.ts";
import { describe, expect, it } from "vitest";

function createArgs(
  overrides: Partial<CreateTerminalArgs> = {}
): CreateTerminalArgs {
  return {
    font: { family: "Monaco", size: 13 },
    frame: { height: 300, width: 400, x: 0, y: 0 },
    panelId: "task-1",
    ...overrides,
  };
}

describe("terminal create launch options", () => {
  it("does not pass profileId through to native when it has no native effect", () => {
    expect(
      nativeLaunchOptions(
        {
          command: "pnpm test",
          cwd: "/tmp/stale",
          env: { PIER_MODE: "dev" },
          profileId: "codex",
        },
        "/tmp/pier"
      )
    ).toEqual({
      command: "pnpm test",
      cwd: "/tmp/pier",
      env: { PIER_MODE: "dev" },
    });
  });

  it("restores a task panel as a task result instead of a default shell", () => {
    const result = resolveCreateTerminalLaunch(
      createArgs({
        context: {
          contextId: "ctx:/tmp/pier",
          cwd: "/tmp/pier",
          projectRoot: "/tmp/pier",
          source: "panel",
          updatedAt: 1_772_000_000_000,
        },
        task: {
          cwd: "/tmp/pier",
          exitCode: 0,
          finishedAt: 1_772_000_001_000,
          label: "test",
          projectRoot: "/tmp/pier",
          rawCommand: "pnpm test",
          runId: "run-1",
          source: "package-script",
          startedAt: 1_772_000_000_000,
          status: "succeeded",
          taskId: "package-script:test",
        },
      }),
      null
    );

    expect(result.nativeLaunch).toMatchObject({
      command: expect.stringContaining("[pier] restored task"),
      cwd: "/tmp/pier",
    });
    expect(result.nativeLaunch?.command).toContain("Task: test");
    expect(result.nativeLaunch?.command).toContain("Status: succeeded");
    expect(result.nativeLaunch?.command).toContain("Exit code: 0");
    expect(result.nativeLaunch?.command).toContain("/bin/sh -lc");
    expect(result.nativeLaunch?.command).toContain("exec ");
    expect(result.nativeLaunch?.command).toContain(" -l");
    expect(result.nativeLaunch?.command).not.toContain("; exit ");
    expect(result.nativeLaunch?.command).not.toBe("pnpm test");
  });

  it("restores an interrupted running task as cancelled display output", () => {
    const result = resolveCreateTerminalLaunch(
      createArgs({
        context: {
          contextId: "ctx:/tmp/pier",
          cwd: "/tmp/pier",
          projectRoot: "/tmp/pier",
          source: "panel",
          updatedAt: 1_772_000_000_000,
        },
        task: {
          cwd: "/tmp/pier",
          label: "dev",
          projectRoot: "/tmp/pier",
          rawCommand: "bun run dev",
          runId: "run-1",
          source: "package-script",
          startedAt: 1_772_000_000_000,
          status: "running",
          taskId: "package-script:dev",
        },
      }),
      null
    );

    expect(result.nativeLaunch?.command).toContain("Task: dev");
    expect(result.nativeLaunch?.command).toContain("Status: cancelled");
    expect(result.nativeLaunch?.command).not.toContain("Status: running");
    expect(result.task).toMatchObject({ status: "cancelled" });
    expect(result.task).not.toHaveProperty("finishedAt");
  });

  it("quotes restored task summary fields as shell literals", () => {
    const markerDir = mkdtempSync(join(tmpdir(), "pier-restore-quote-"));
    const markerPath = join(markerDir, "pwn");
    const previousShell = process.env.SHELL;
    process.env.SHELL = "/usr/bin/true";
    try {
      const result = resolveCreateTerminalLaunch(
        createArgs({
          task: {
            cwd: "/tmp/pier",
            label: `x'; touch ${markerPath}; #`,
            projectRoot: "/tmp/pier",
            rawCommand: `$(touch ${markerPath})`,
            runId: "run-1",
            source: "history",
            startedAt: 1_772_000_000_000,
            status: "failed",
            taskId: "history:dev",
          },
        }),
        null
      );

      const command = result.nativeLaunch?.command;
      expect(command).toBeTruthy();
      const run = spawnSync("/bin/sh", ["-c", command ?? ""], {
        encoding: "utf8",
      });

      expect(run.stdout).toContain(`Task: x'; touch ${markerPath}; #`);
      expect(run.stdout).toContain(`Command: $(touch ${markerPath})`);
      expect(existsSync(markerPath)).toBe(false);
    } finally {
      if (previousShell === undefined) {
        delete process.env.SHELL;
      } else {
        process.env.SHELL = previousShell;
      }
      rmSync(markerDir, { force: true, recursive: true });
    }
  });
  it("prefers explicit relaunch metadata over a saved running task", () => {
    const launchId = terminalLaunchRegistry.register({
      command: "pnpm lint",
      cwd: "/tmp/pier",
    });
    const relaunchTask = {
      cwd: "/tmp/pier",
      label: "lint",
      projectRoot: "/tmp/pier",
      rawCommand: "pnpm lint",
      runId: "run-2",
      source: "package-script",
      startedAt: 1_772_000_002_000,
      status: "running",
      taskId: "package-script:lint",
    } as const;
    const saved: TerminalPanelSession = {
      task: {
        cwd: "/tmp/pier",
        label: "dev",
        projectRoot: "/tmp/pier",
        rawCommand: "pnpm dev",
        runId: "run-1",
        source: "package-script",
        startedAt: 1_772_000_001_000,
        status: "running",
        taskId: "package-script:dev",
      },
      updatedAt: "2026-06-30T00:00:00.000Z",
    };
    try {
      const result = resolveCreateTerminalLaunch(
        createArgs({
          launchId,
          task: relaunchTask,
        }),
        saved
      );

      expect(result.task).toEqual(relaunchTask);
      expect(result.nativeLaunch?.command).toBe("pnpm lint");
      expect(result.nativeLaunch?.command).not.toContain(
        "[pier] restored task"
      );
    } finally {
      terminalLaunchRegistry.discard(launchId);
    }
  });

  it("prefers saved restore metadata when no explicit launch is present", () => {
    const savedContext = {
      contextId: "ctx:/tmp/saved",
      cwd: "/tmp/saved",
      projectRoot: "/tmp/saved",
      source: "panel",
      updatedAt: 1_772_000_003_000,
    } as const;
    const argsContext = {
      contextId: "ctx:/tmp/args",
      cwd: "/tmp/args",
      projectRoot: "/tmp/args",
      source: "panel",
      updatedAt: 1_772_000_004_000,
    } as const;
    const savedTask = {
      cwd: "/tmp/saved",
      exitCode: 0,
      finishedAt: 1_772_000_005_000,
      label: "saved:test",
      projectRoot: "/tmp/saved",
      rawCommand: "pnpm saved:test",
      runId: "run-saved",
      source: "package-script",
      startedAt: 1_772_000_003_500,
      status: "succeeded",
      taskId: "package-script:saved-test",
    } as const;
    const argsTask = {
      cwd: "/tmp/args",
      exitCode: 1,
      finishedAt: 1_772_000_006_000,
      label: "args:test",
      projectRoot: "/tmp/args",
      rawCommand: "pnpm args:test",
      runId: "run-args",
      source: "package-script",
      startedAt: 1_772_000_004_500,
      status: "failed",
      taskId: "package-script:args-test",
    } as const;
    const saved: TerminalPanelSession = {
      context: savedContext,
      task: savedTask,
      updatedAt: "2026-06-30T00:00:00.000Z",
    };

    const result = resolveCreateTerminalLaunch(
      createArgs({
        context: argsContext,
        task: argsTask,
      }),
      saved
    );

    expect(result.context).toEqual(savedContext);
    expect(result.task).toEqual(savedTask);
    expect(result.nativeLaunch).toMatchObject({
      command: expect.stringContaining("[pier] restored task"),
      cwd: "/tmp/saved",
    });
    expect(result.nativeLaunch?.command).toContain("Task: saved:test");
    expect(result.nativeLaunch?.command).toContain("Command: pnpm saved:test");
    expect(result.nativeLaunch?.command).not.toContain("args:test");
    expect(result.nativeLaunch?.command).not.toContain("pnpm args:test");
  });
});
