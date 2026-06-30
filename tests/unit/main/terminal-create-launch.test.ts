import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  nativeLaunchOptions,
  resolveCreateTerminalLaunch,
} from "@main/ipc/terminal-create-launch.ts";
import type { CreateTerminalArgs } from "@shared/contracts/terminal.ts";
import { describe, expect, it } from "vitest";

function createArgs(
  overrides: Partial<CreateTerminalArgs> = {}
): CreateTerminalArgs {
  return {
    font: { family: ["Monaco"], size: 13 },
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
});
