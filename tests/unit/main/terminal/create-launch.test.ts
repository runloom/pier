import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  nativeLaunchOptions,
  resolveCreateTerminalLaunch,
  withAgentLoginShellSafeCommand,
  wrapAgentTerminalCommand,
} from "@main/ipc/terminal/create-launch.ts";
import { isAlreadyShellWrappedCommand } from "@main/services/process-environment/resolve-user-command.ts";
import { terminalLaunchRegistry } from "@main/state/terminal-launch-state.ts";
import type { TerminalPanelSession } from "@main/state/terminal-session-state.ts";
import type { CreateTerminalArgs } from "@shared/contracts/terminal.ts";
import { describe, expect, it } from "vitest";

function createArgs(
  overrides: Partial<CreateTerminalArgs> = {}
): CreateTerminalArgs {
  return {
    font: { family: ["Monaco"], size: 13 },
    frame: { height: 300, width: 400, x: 0, y: 0 },
    panelId: "task-1",
    presentationId: 1,
    ...overrides,
  };
}

function savedRunningDevSession(): TerminalPanelSession {
  return {
    context: {
      contextId: "ctx:/tmp/pier",
      cwd: "/tmp/pier",
      projectRootPath: "/tmp/pier",
      source: "panel",
      updatedAt: 1_772_000_000_000,
    },
    task: {
      cwd: "/tmp/pier",
      label: "dev",
      projectRootPath: "/tmp/pier",
      rawCommand: "bun run dev",
      runId: "run-1",
      source: "package-script",
      startedAt: 1_772_000_000_000,
      status: "running",
      taskId: "package-script:dev",
    },
    updatedAt: "2026-06-30T00:00:00.000Z",
  };
}

describe("wrapAgentTerminalCommand", () => {
  it("sync fallback wraps under user shell -lic", () => {
    expect(wrapAgentTerminalCommand("copilot --yolo", "/bin/zsh")).toBe(
      "/bin/zsh -lic 'copilot --yolo'"
    );
    expect(wrapAgentTerminalCommand("codex", "/bin/zsh")).toBe(
      "/bin/zsh -lic codex"
    );
    expect(wrapAgentTerminalCommand("codex", "/opt/homebrew/bin/fish")).toBe(
      "/opt/homebrew/bin/fish -l -i -c codex"
    );
  });

  it("is idempotent for already-wrapped and Ghostty-prefixed commands", () => {
    const wrapped = wrapAgentTerminalCommand("copilot --yolo", "/bin/zsh");
    expect(wrapAgentTerminalCommand(wrapped, "/bin/zsh")).toBe(wrapped);
    expect(wrapAgentTerminalCommand("shell:copilot --yolo")).toBe(
      "shell:copilot --yolo"
    );
    expect(wrapAgentTerminalCommand("direct:copilot --yolo")).toBe(
      "direct:copilot --yolo"
    );
    expect(wrapAgentTerminalCommand("/bin/sh -c 'exec /x'", "/bin/zsh")).toBe(
      "/bin/sh -c 'exec /x'"
    );
  });
});

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

  it("keeps agent command unwrapped in nativeLaunchOptions for session/resume", () => {
    expect(
      nativeLaunchOptions(
        {
          agentId: "copilot",
          command: "copilot --yolo",
          cwd: "/tmp/pier",
        },
        "/tmp/pier"
      )
    ).toEqual({
      agentId: "copilot",
      command: "copilot --yolo",
      cwd: "/tmp/pier",
    });
  });

  it("last-mile wraps agent spawn command without mutating non-agent launches", async () => {
    const wrapped = await withAgentLoginShellSafeCommand(
      {
        agentId: "copilot",
        command: "copilot --yolo",
        cwd: "/tmp/pier",
        env: {
          PATH: "/usr/bin:/bin",
          SHELL: "/bin/zsh",
        },
      },
      "copilot"
    );
    expect(wrapped.launch?.command).toMatch(
      /^(\/bin\/sh -c |\/bin\/zsh -lic )/
    );
    expect(wrapped.launch?.cwd).toBe("/tmp/pier");
    expect(
      await withAgentLoginShellSafeCommand(
        { command: "pnpm test", cwd: "/tmp/pier" },
        undefined
      )
    ).toEqual({ launch: { command: "pnpm test", cwd: "/tmp/pier" } });
  });

  it("restores a task panel as a task result instead of a default shell", () => {
    const result = resolveCreateTerminalLaunch(
      createArgs({
        context: {
          contextId: "ctx:/tmp/pier",
          cwd: "/tmp/pier",
          projectRootPath: "/tmp/pier",
          source: "panel",
          updatedAt: 1_772_000_000_000,
        },
        task: {
          cwd: "/tmp/pier",
          exitCode: 0,
          finishedAt: 1_772_000_001_000,
          label: "test",
          projectRootPath: "/tmp/pier",
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

    expect(result.nativeLaunch).toEqual({
      cwd: "/tmp/pier",
    });
    expect(result.nativeLaunch?.command).toBeUndefined();
    expect(result.initialInput).toContain("[pier] restored task");
    expect(result.initialInput).toContain("Task: test");
    expect(result.initialInput).toContain("Status: succeeded");
    expect(result.initialInput).toContain("Exit code: 0");
    expect(isAlreadyShellWrappedCommand(result.initialInput ?? "")).toBe(false);
    expect(result.initialInput).not.toContain("exec ");
    expect(result.initialInput).not.toMatch(/ -l(?:c|\s|$)/);
    expect(result.initialInput).not.toBe("pnpm test");
  });

  it("restores an interrupted running task as cancelled display output", () => {
    const result = resolveCreateTerminalLaunch(
      createArgs({
        context: {
          contextId: "ctx:/tmp/pier",
          cwd: "/tmp/pier",
          projectRootPath: "/tmp/pier",
          source: "panel",
          updatedAt: 1_772_000_000_000,
        },
        task: {
          cwd: "/tmp/pier",
          label: "dev",
          projectRootPath: "/tmp/pier",
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

    expect(result.initialInput).toContain("Task: dev");
    expect(result.initialInput).toContain("Status: cancelled");
    expect(result.initialInput).not.toContain("Status: running");
    expect(result.nativeLaunch?.command).toBeUndefined();
    expect(result.task).toMatchObject({ status: "cancelled" });
    expect(result.task).not.toHaveProperty("finishedAt");
  });

  it("quotes restored task summary fields as shell literals", () => {
    const markerPath = "/tmp/pier-restore-pwn";
    const label = `x'; touch ${markerPath}; #`;
    const rawCommand = `$(touch ${markerPath})`;
    const result = resolveCreateTerminalLaunch(
      createArgs({
        task: {
          cwd: "/tmp/pier",
          label,
          projectRootPath: "/tmp/pier",
          rawCommand,
          runId: "run-1",
          source: "history",
          startedAt: 1_772_000_000_000,
          status: "failed",
          taskId: "history:dev",
        },
      }),
      null
    );

    const script = result.initialInput ?? "";
    expect(script).toContain("[pier] restored task");
    expect(script).toMatch(/Task: x/);
    expect(script).toContain("pier-restore-pwn");
    expect(script).toContain("$(touch");
    expect(isAlreadyShellWrappedCommand(script)).toBe(false);
  });
  it("prefers explicit relaunch metadata over a saved running task", () => {
    const launchId = terminalLaunchRegistry.register({
      command: "pnpm lint",
      cwd: "/tmp/pier",
    });
    const relaunchTask = {
      cwd: "/tmp/pier",
      label: "lint",
      projectRootPath: "/tmp/pier",
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
        projectRootPath: "/tmp/pier",
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
      projectRootPath: "/tmp/saved",
      source: "panel",
      updatedAt: 1_772_000_003_000,
    } as const;
    const argsContext = {
      contextId: "ctx:/tmp/args",
      cwd: "/tmp/args",
      projectRootPath: "/tmp/args",
      source: "panel",
      updatedAt: 1_772_000_004_000,
    } as const;
    const savedTask = {
      cwd: "/tmp/saved",
      exitCode: 0,
      finishedAt: 1_772_000_005_000,
      label: "saved:test",
      projectRootPath: "/tmp/saved",
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
      projectRootPath: "/tmp/args",
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
    expect(result.nativeLaunch).toEqual({ cwd: "/tmp/saved" });
    expect(result.initialInput).toContain("[pier] restored task");
    expect(result.initialInput).toContain("Task: saved:test");
    expect(result.initialInput).toContain("Command: pnpm saved:test");
    expect(result.initialInput).not.toContain("args:test");
    expect(result.initialInput).not.toContain("pnpm args:test");
  });

  it("passes a live saved running task through unchanged on renderer reload", () => {
    const saved = savedRunningDevSession();

    const result = resolveCreateTerminalLaunch(createArgs(), saved, {
      taskLive: true,
    });

    expect(result.task).toEqual(saved.task);
    expect(result.task?.status).toBe("running");
    expect(result.launchAgentId).toBeUndefined();
    expect(result.nativeLaunch).toEqual({ cwd: "/tmp/pier" });
    expect(result.nativeLaunch?.command).toBeUndefined();
  });

  it("coerces the same saved running task to a cancelled summary without taskLive", () => {
    const saved = savedRunningDevSession();

    const result = resolveCreateTerminalLaunch(createArgs(), saved);

    expect(result.task).toMatchObject({ status: "cancelled" });
    expect(result.nativeLaunch).toEqual({ cwd: "/tmp/pier" });
    expect(result.initialInput).toContain("[pier] restored task");
    expect(result.initialInput).toContain("Status: cancelled");
    expect(result.initialInput).not.toContain("Status: running");
  });

  it("falls back shell cwd to projectRootPath when context.cwd is missing", () => {
    const launchId = terminalLaunchRegistry.register({
      agentId: "claude",
      command: "claude",
    });
    try {
      const result = resolveCreateTerminalLaunch(
        createArgs({
          context: {
            contextId: "ctx:/repo",
            gitRoot: "/repo",
            projectRootPath: "/repo",
            source: "panel",
            updatedAt: 1_772_000_000_000,
          },
          launchId,
        }),
        null
      );
      expect(result.nativeLaunch).toMatchObject({
        agentId: "claude",
        command: "claude",
        cwd: "/repo",
      });
    } finally {
      terminalLaunchRegistry.discard(launchId);
    }
  });

  it("restores a previously running agent panel by relaunching the saved agent command", async () => {
    const saved = {
      agent: {
        agentId: "claude",
        launch: {
          agentId: "claude",
          command: "claude --dangerously-skip-permissions",
          cwd: "/tmp/pier",
        },
        startedAt: 1_772_000_000_000,
        status: "running",
      },
      context: {
        contextId: "ctx:/tmp/pier",
        cwd: "/tmp/pier",
        projectRootPath: "/tmp/pier",
        source: "panel",
        updatedAt: 1_772_000_000_000,
      },
      updatedAt: "2026-07-06T00:00:00.000Z",
    } as TerminalPanelSession;

    const result = resolveCreateTerminalLaunch(createArgs(), saved);

    expect(result.launchAgentId).toBe("claude");
    expect(result.restoredAgent).toEqual(saved.agent);
    expect(result.nativeLaunch).toEqual({
      agentId: "claude",
      command: "claude --dangerously-skip-permissions",
      cwd: "/tmp/pier",
    });
    // Spawn boundary still wraps for Ghostty login argv0 safety.
    const spawnCommand = (
      await withAgentLoginShellSafeCommand(
        {
          ...result.nativeLaunch,
          env: {
            ...(result.nativeLaunch?.env ?? {}),
            PATH: "/usr/bin:/bin",
            SHELL: "/bin/zsh",
          },
        },
        result.launchAgentId
      )
    ).launch?.command;
    expect(spawnCommand).toMatch(/^(\/bin\/sh -c |\/bin\/zsh -lic )/);
    expect(spawnCommand).toContain("claude");
  });

  it("launches shebang agents via login-shell -c without typing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pier-omp-"));
    const script = join(dir, "omp");
    writeFileSync(script, "#!/usr/bin/env bun\n");
    chmodSync(script, 0o755);
    const spawn = await withAgentLoginShellSafeCommand(
      {
        agentId: "omp",
        command: script,
        cwd: "/tmp/pier",
        env: { PATH: dir, SHELL: "/bin/zsh" },
      },
      "omp"
    );
    expect(spawn.launch?.cwd).toBe("/tmp/pier");
    expect(spawn.launch?.command).toEqual(
      expect.stringMatching(/^\/bin\/zsh -lic /)
    );
    expect(spawn.launch?.command).toContain(script);
    const named = await withAgentLoginShellSafeCommand(
      {
        agentId: "omp",
        command: "omp --yolo",
        cwd: "/tmp/pier",
        env: { PATH: dir, SHELL: "/bin/zsh" },
      },
      "omp"
    );
    expect(named.launch?.command).toContain("omp --yolo");
    expect(named.launch?.command).toEqual(
      expect.stringMatching(/^\/bin\/zsh -lic /)
    );
    rmSync(dir, { force: true, recursive: true });
  });
});
