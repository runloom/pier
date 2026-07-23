import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as TerminalSessionStateModule from "@main/state/terminal-session-state.ts";
import type * as TerminalSessionTransferModule from "@main/state/terminal-session-transfer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { TaskPanelMetadata } from "@shared/contracts/tasks.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function taskMetadata(
  overrides: Partial<TaskPanelMetadata> = {}
): TaskPanelMetadata {
  return {
    cwd: "/Users/dev/ABC/pier",
    label: "test",
    projectRootPath: "/Users/dev/ABC/pier",
    rawCommand: "pnpm test",
    runId: "run-1",
    source: "package-script",
    startedAt: 1_772_000_000_000,
    status: "running",
    taskId: "package-script:test",
    ...overrides,
  };
}

function context(root: string, updatedAt = 1_772_000_000_000): PanelContext {
  return {
    contextId: `ctx:${root}`,
    cwd: root,
    openedPath: root,
    projectRootPath: root,
    source: "panel",
    updatedAt,
    worktreeKey: root,
  };
}

async function loadTerminalSessionState(): Promise<
  typeof TerminalSessionStateModule & typeof TerminalSessionTransferModule
> {
  // Dynamic import is required because each test resets modules and mocks electron app.getPath before this state module resolves userData.
  const state = await import("@main/state/terminal-session-state.ts");
  const transfer = await import("@main/state/terminal-session-transfer.ts");
  return { ...state, ...transfer };
}

describe("terminal session state", () => {
  let userDataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    userDataDir = await mkdtemp(join(tmpdir(), "pier-terminal-session-"));
    vi.doMock("electron", () => ({
      app: {
        getPath: vi.fn((name: string) => {
          if (name !== "userData") {
            throw new Error(`unexpected app path: ${name}`);
          }
          return userDataDir;
        }),
      },
    }));
  });

  afterEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(userDataDir, { force: true, recursive: true });
  });

  it("persists and reads the last context by window and panel", async () => {
    const { readTerminalPanelSession, updateTerminalPanelContext } =
      await loadTerminalSessionState();

    const pier = context("/Users/dev/ABC/pier");
    await updateTerminalPanelContext("main", "terminal-1", pier);

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({ context: pier });
    await expect(
      readTerminalPanelSession("w-2", "terminal-1")
    ).resolves.toBeNull();
  });

  it("persists and reads the last terminal title with context", async () => {
    const {
      readTerminalPanelSession,
      updateTerminalPanelContext,
      updateTerminalPanelTitle,
    } = await loadTerminalSessionState();

    const pier = context("/Users/dev/ABC/pier");
    await updateTerminalPanelContext("main", "terminal-1", pier);
    await updateTerminalPanelTitle("main", "terminal-1", "Claude Code");

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      context: pier,
      title: "Claude Code",
    });
  });

  it("persists and patches tab chrome without requiring business state storage", async () => {
    const {
      patchTerminalPanelTab,
      readTerminalPanelSession,
      updateTerminalPanelContext,
      updateTerminalPanelTab,
    } = await loadTerminalSessionState();

    const pier = context("/Users/dev/ABC/pier");
    await updateTerminalPanelContext("main", "terminal-1", pier);
    await updateTerminalPanelTab("main", "terminal-1", {
      badge: { label: "package.json" },
      icon: { id: "pier.task" },
      state: { label: "Running", status: "running" },
      title: "test",
    });
    const legacyPatch = {
      state: {
        busy: false,
        colorToken: "success",
        label: "Succeeded",
      },
    } as unknown as Parameters<typeof patchTerminalPanelTab>[2];
    await patchTerminalPanelTab("main", "terminal-1", legacyPatch);

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      context: pier,
      tab: {
        badge: { label: "package.json" },
        icon: { id: "pier.task" },
        state: {
          colorToken: "success",
          label: "Succeeded",
          status: "succeeded",
        },
        title: "test",
      },
    });
  });

  it("persists task identity and patches terminal task status", async () => {
    const {
      patchTerminalPanelTaskStatus,
      readTerminalPanelSession,
      updateTerminalPanelTask,
    } = await loadTerminalSessionState();

    await updateTerminalPanelTask(
      "main",
      "terminal-1",
      taskMetadata({ status: "running" })
    );

    await expect(
      patchTerminalPanelTaskStatus("main", "terminal-1", "run-1", {
        exitCode: 1,
        finishedAt: 1_772_000_001_000,
        status: "failed",
      })
    ).resolves.toBe(true);
    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      task: {
        exitCode: 1,
        finishedAt: 1_772_000_001_000,
        label: "test",
        rawCommand: "pnpm test",
        runId: "run-1",
        status: "failed",
        taskId: "package-script:test",
      },
    });
  });

  it("preserves saved agent identity for restart restore decisions", async () => {
    const { readTerminalPanelSession } = await loadTerminalSessionState();
    const pier = context("/Users/dev/ABC/pier");
    await writeFile(
      join(userDataDir, "terminal-session-state.json"),
      `${JSON.stringify({
        version: 1,
        windows: {
          main: {
            panels: {
              "terminal-1": {
                agent: {
                  agentId: "claude",
                  launch: {
                    agentId: "claude",
                    command: "claude --dangerously-skip-permissions",
                    cwd: "/Users/dev/ABC/pier",
                  },
                  startedAt: 1_772_000_000_000,
                  status: "running",
                },
                context: pier,
                updatedAt: "2026-07-06T00:00:00.000Z",
              },
            },
          },
        },
      })}\n`,
      "utf-8"
    );

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      agent: {
        agentId: "claude",
        launch: {
          command: "claude --dangerously-skip-permissions",
          cwd: "/Users/dev/ABC/pier",
        },
        status: "running",
      },
    });
  });

  it("strips saved agent launch env while preserving restore fields", async () => {
    const { flushTerminalSessionState, readTerminalPanelSession } =
      await loadTerminalSessionState();
    await writeFile(
      join(userDataDir, "terminal-session-state.json"),
      `${JSON.stringify({
        version: 1,
        windows: {
          main: {
            panels: {
              "terminal-1": {
                agent: {
                  agentId: "claude",
                  launch: {
                    agentId: "claude",
                    command: "claude",
                    cwd: "/repo",
                    env: {
                      OPENAI_API_KEY: "sk-secret",
                    },
                  },
                  startedAt: 1_772_000_000_000,
                  status: "running",
                },
                updatedAt: "2026-07-06T00:00:00.000Z",
              },
            },
          },
        },
      })}\n`,
      "utf-8"
    );

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      agent: {
        launch: {
          agentId: "claude",
          command: "claude",
          cwd: "/repo",
        },
      },
    });
    await flushTerminalSessionState();
    await expect(
      readFile(join(userDataDir, "terminal-session-state.json"), "utf-8")
    ).resolves.not.toContain("OPENAI_API_KEY");
    await expect(
      readFile(join(userDataDir, "terminal-session-state.json"), "utf-8")
    ).resolves.not.toContain("sk-secret");
  });

  it("persists agent resume metadata from hook session ids", async () => {
    const {
      readTerminalPanelSession,
      updateTerminalPanelAgent,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    await updateTerminalPanelAgent("main", "terminal-1", {
      agentId: "claude",
      launch: {
        agentId: "claude",
        command: "claude",
        cwd: "/repo",
      },
      startedAt: 1_772_000_000_000,
      status: "running",
    });

    await expect(
      updateTerminalPanelAgentResume("main", "terminal-1", {
        agentId: "claude",
        capturedAt: 1_772_000_001_000,
        sessionId: "session-123",
        source: "hook",
      })
    ).resolves.toBe(true);

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      agent: {
        resume: {
          capturedAt: 1_772_000_001_000,
          sessionId: "session-123",
          source: "hook",
        },
      },
    });
  });

  it("does not attach resume metadata to another agent or exited session", async () => {
    const {
      readTerminalPanelSession,
      updateTerminalPanelAgent,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    await updateTerminalPanelAgent("main", "terminal-1", {
      agentId: "claude",
      finishedAt: 1_772_000_001_000,
      launch: {
        agentId: "claude",
        command: "claude",
        cwd: "/repo",
      },
      startedAt: 1_772_000_000_000,
      status: "exited",
    });

    await expect(
      updateTerminalPanelAgentResume("main", "terminal-1", {
        agentId: "codex",
        capturedAt: 1_772_000_002_000,
        sessionId: "wrong-agent-session",
        source: "hook",
      })
    ).resolves.toBe(false);

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.not.toHaveProperty("agent.resume");
  });

  it("normalizes saved agent resume metadata without keeping raw hook payload", async () => {
    const { flushTerminalSessionState, readTerminalPanelSession } =
      await loadTerminalSessionState();
    await writeFile(
      join(userDataDir, "terminal-session-state.json"),
      `${JSON.stringify({
        version: 1,
        windows: {
          main: {
            panels: {
              "terminal-1": {
                agent: {
                  agentId: "claude",
                  launch: {
                    agentId: "claude",
                    command: "claude",
                    cwd: "/repo",
                  },
                  resume: {
                    capturedAt: 1_772_000_001_000,
                    rawPayload: "OPENAI_API_KEY=sk-secret",
                    sessionId: "session-123",
                    source: "hook",
                  },
                  startedAt: 1_772_000_000_000,
                  status: "running",
                },
                updatedAt: "2026-07-06T00:00:00.000Z",
              },
            },
          },
        },
      })}\n`,
      "utf-8"
    );

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      agent: {
        resume: {
          capturedAt: 1_772_000_001_000,
          sessionId: "session-123",
          source: "hook",
        },
      },
    });
    await flushTerminalSessionState();
    await expect(
      readFile(join(userDataDir, "terminal-session-state.json"), "utf-8")
    ).resolves.not.toContain("OPENAI_API_KEY");
    await expect(
      readFile(join(userDataDir, "terminal-session-state.json"), "utf-8")
    ).resolves.not.toContain("sk-secret");
  });

  it("allows command-finished to add an exit code after agent already exited", async () => {
    const {
      patchTerminalPanelAgentStatus,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
    } = await loadTerminalSessionState();
    await updateTerminalPanelAgent("main", "terminal-1", {
      agentId: "claude",
      launch: {
        agentId: "claude",
        command: "claude",
        cwd: "/repo",
      },
      startedAt: 1_772_000_000_000,
      status: "running",
    });

    await expect(
      patchTerminalPanelAgentStatus("main", "terminal-1", {
        finishedAt: 1_772_000_001_000,
        status: "exited",
      })
    ).resolves.toBe(true);
    await expect(
      patchTerminalPanelAgentStatus("main", "terminal-1", {
        exitCode: 42,
        finishedAt: 1_772_000_002_000,
        status: "exited",
      })
    ).resolves.toBe(true);
    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      agent: {
        exitCode: 42,
        finishedAt: 1_772_000_002_000,
        status: "exited",
      },
      tab: {
        state: {
          label: "Exited 42",
          status: "failed",
        },
      },
    });
  });

  it("persists task exit reason and source with terminal task status", async () => {
    const {
      patchTerminalPanelTaskStatus,
      readTerminalPanelSession,
      updateTerminalPanelTask,
    } = await loadTerminalSessionState();

    await updateTerminalPanelTask(
      "main",
      "terminal-1",
      taskMetadata({ status: "running" })
    );

    await expect(
      patchTerminalPanelTaskStatus("main", "terminal-1", "run-1", {
        exitCode: 0,
        exitReason: "process",
        exitSource: "native-process-close",
        finishedAt: 1_772_000_001_000,
        status: "succeeded",
      })
    ).resolves.toBe(true);

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      task: {
        exitCode: 0,
        exitReason: "process",
        exitSource: "native-process-close",
        finishedAt: 1_772_000_001_000,
        status: "succeeded",
      },
    });
  });

  it("persists unknown process exits without an exit code", async () => {
    const {
      patchTerminalPanelTaskStatus,
      readTerminalPanelSession,
      updateTerminalPanelTask,
    } = await loadTerminalSessionState();

    await updateTerminalPanelTask(
      "main",
      "terminal-1",
      taskMetadata({ status: "running" })
    );

    await expect(
      patchTerminalPanelTaskStatus("main", "terminal-1", "run-1", {
        exitReason: "process",
        exitSource: "native-process-close",
        finishedAt: 1_772_000_001_000,
        status: "failed",
      })
    ).resolves.toBe(true);

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      task: {
        exitReason: "process",
        exitSource: "native-process-close",
        finishedAt: 1_772_000_001_000,
        status: "failed",
      },
    });
  });

  it("does not rewrite completed task status", async () => {
    const {
      patchTerminalPanelTaskStatus,
      readTerminalPanelSession,
      updateTerminalPanelTask,
    } = await loadTerminalSessionState();

    await updateTerminalPanelTask(
      "main",
      "terminal-1",
      taskMetadata({
        exitCode: 0,
        finishedAt: 1_772_000_001_000,
        status: "succeeded",
      })
    );

    await expect(
      patchTerminalPanelTaskStatus("main", "terminal-1", "run-1", {
        exitCode: 1,
        finishedAt: 1_772_000_002_000,
        status: "failed",
      })
    ).resolves.toBe(false);
    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      task: {
        exitCode: 0,
        finishedAt: 1_772_000_001_000,
        status: "succeeded",
      },
    });
  });

  it("recognizes an already-applied completion for tab-patch retries", async () => {
    const { patchTerminalPanelTaskStatus, updateTerminalPanelTask } =
      await loadTerminalSessionState();
    await updateTerminalPanelTask(
      "main",
      "terminal-1",
      taskMetadata({
        exitCode: 0,
        finishedAt: 1_772_000_001_000,
        status: "succeeded",
      })
    );

    await expect(
      patchTerminalPanelTaskStatus("main", "terminal-1", "run-1", {
        exitCode: 0,
        finishedAt: 1_772_000_001_000,
        status: "succeeded",
      })
    ).resolves.toBe(true);
  });

  it("does not patch task status for plain terminal sessions", async () => {
    const {
      patchTerminalPanelTaskStatus,
      readTerminalPanelSession,
      updateTerminalPanelContext,
    } = await loadTerminalSessionState();

    await updateTerminalPanelContext(
      "main",
      "terminal-1",
      context("/Users/dev/ABC/pier")
    );

    await expect(
      patchTerminalPanelTaskStatus("main", "terminal-1", "run-1", {
        exitCode: 0,
        finishedAt: 1_772_000_001_000,
        status: "succeeded",
      })
    ).resolves.toBe(false);
    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.not.toHaveProperty("task");
  });

  it("normalizes legacy busy tab JSON without resetting the session", async () => {
    const pier = context("/Users/dev/ABC/pier");
    await writeFile(
      join(userDataDir, "terminal-session-state.json"),
      JSON.stringify({
        version: 1,
        windows: {
          main: {
            panels: {
              "terminal-1": {
                context: pier,
                tab: {
                  icon: { id: "pier.task" },
                  state: { busy: true, label: "Running" },
                  title: "test",
                },
                title: "test",
                updatedAt: "2026-06-26T00:00:00.000Z",
              },
            },
          },
        },
      })
    );

    const { flushTerminalSessionState, readTerminalPanelSession } =
      await loadTerminalSessionState();

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      context: pier,
      tab: {
        icon: { id: "pier.task" },
        state: { label: "Running", status: "running" },
        title: "test",
      },
      title: "test",
    });
    await flushTerminalSessionState();

    const stored = JSON.parse(
      await readFile(join(userDataDir, "terminal-session-state.json"), "utf-8")
    );
    expect(stored.windows.main.panels["terminal-1"].tab.state).toEqual({
      label: "Running",
      status: "running",
    });
  });

  it("does not create a session for a title without context", async () => {
    const { readTerminalPanelSession, updateTerminalPanelTitle } =
      await loadTerminalSessionState();

    await updateTerminalPanelTitle("main", "terminal-1", "Shell");

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toBeNull();
  });

  it("serializes concurrent context updates without dropping panel sessions", async () => {
    const { readTerminalPanelSession, updateTerminalPanelContext } =
      await loadTerminalSessionState();

    await expect(
      Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          updateTerminalPanelContext(
            "main",
            `terminal-${index}`,
            context(`/tmp/pier-terminal-${index}`, index)
          )
        )
      )
    ).resolves.toHaveLength(20);

    for (let index = 0; index < 20; index += 1) {
      await expect(
        readTerminalPanelSession("main", `terminal-${index}`)
      ).resolves.toMatchObject({
        context: context(`/tmp/pier-terminal-${index}`, index),
      });
    }
  });

  it("removes a closed terminal session without keeping a recent-closed list", async () => {
    const {
      readTerminalPanelSession,
      removeTerminalPanelSession,
      updateTerminalPanelContext,
      updateTerminalPanelTitle,
    } = await loadTerminalSessionState();

    const pier = context("/Users/dev/ABC/pier");
    await updateTerminalPanelContext("main", "terminal-1", pier);
    await updateTerminalPanelTitle("main", "terminal-1", "Claude Code");

    await removeTerminalPanelSession("main", "terminal-1");

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toBeNull();
  });

  it("normalizes state to panel sessions only", async () => {
    const pier = context("/Users/dev/ABC/pier");
    await writeFile(
      join(userDataDir, "terminal-session-state.json"),
      JSON.stringify({
        version: 1,
        windows: {
          main: {
            panels: {
              "terminal-1": {
                context: pier,
                title: "Claude Code",
                updatedAt: "2026-06-26T00:00:00.000Z",
              },
            },
            recentClosed: [
              {
                closedAt: "2026-06-26T00:00:01.000Z",
                context: pier,
                id: "terminal-1:2026-06-26T00:00:01.000Z",
                panelId: "terminal-1",
              },
            ],
          },
        },
      })
    );

    const { flushTerminalSessionState, readTerminalPanelSession } =
      await loadTerminalSessionState();

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      context: pier,
      title: "Claude Code",
    });
    await flushTerminalSessionState();

    const stored = JSON.parse(
      await readFile(join(userDataDir, "terminal-session-state.json"), "utf-8")
    );
    expect(stored).toEqual({
      version: 1,
      windows: {
        main: {
          panels: {
            "terminal-1": {
              context: pier,
              title: "Claude Code",
              updatedAt: "2026-06-26T00:00:00.000Z",
            },
          },
        },
      },
    });
  });

  it("sweeps orphaned running tasks to cancelled with restore exit metadata", async () => {
    const {
      readTerminalPanelSession,
      reconcileOrphanedRunningTasks,
      updateTerminalPanelContext,
      updateTerminalPanelTab,
      updateTerminalPanelTask,
    } = await loadTerminalSessionState();

    const pier = context("/Users/dev/ABC/pier");
    await updateTerminalPanelContext("main", "terminal-1", pier);
    await updateTerminalPanelTask(
      "main",
      "terminal-1",
      taskMetadata({ status: "running" })
    );
    await updateTerminalPanelTab("main", "terminal-1", {
      badge: { label: "package.json" },
      icon: { id: "pier.task" },
      state: { label: "Running", status: "running" },
      title: "test",
    });

    await expect(
      reconcileOrphanedRunningTasks(() => 1_772_000_009_000)
    ).resolves.toBe(1);

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      tab: {
        badge: { label: "package.json" },
        icon: { id: "pier.task" },
        state: {
          colorToken: "warning",
          label: "Cancelled",
          status: "cancelled",
        },
        title: "test",
      },
      task: {
        exitReason: "restore",
        exitSource: "restore",
        finishedAt: 1_772_000_009_000,
        status: "cancelled",
      },
    });
  });

  it("leaves finished tasks and plain sessions untouched during the sweep", async () => {
    const {
      readTerminalPanelSession,
      reconcileOrphanedRunningTasks,
      updateTerminalPanelContext,
      updateTerminalPanelTask,
    } = await loadTerminalSessionState();

    const pier = context("/Users/dev/ABC/pier");
    await updateTerminalPanelTask(
      "main",
      "terminal-1",
      taskMetadata({
        exitCode: 0,
        finishedAt: 1_772_000_001_000,
        status: "succeeded",
      })
    );
    await updateTerminalPanelTask(
      "main",
      "terminal-2",
      taskMetadata({
        exitCode: 1,
        finishedAt: 1_772_000_002_000,
        runId: "run-2",
        status: "failed",
        taskId: "package-script:lint",
      })
    );
    await updateTerminalPanelTask(
      "main",
      "terminal-3",
      taskMetadata({
        finishedAt: 1_772_000_003_000,
        runId: "run-3",
        status: "cancelled",
        taskId: "package-script:dev",
      })
    );
    await updateTerminalPanelContext("main", "terminal-4", pier);

    await expect(
      reconcileOrphanedRunningTasks(() => 1_772_000_009_000)
    ).resolves.toBe(0);

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      task: {
        exitCode: 0,
        finishedAt: 1_772_000_001_000,
        status: "succeeded",
      },
    });
    await expect(
      readTerminalPanelSession("main", "terminal-2")
    ).resolves.toMatchObject({
      task: { exitCode: 1, finishedAt: 1_772_000_002_000, status: "failed" },
    });
    await expect(
      readTerminalPanelSession("main", "terminal-3")
    ).resolves.toMatchObject({
      task: { finishedAt: 1_772_000_003_000, status: "cancelled" },
    });
    const plain = await readTerminalPanelSession("main", "terminal-4");
    expect(plain).toMatchObject({ context: pier });
    expect(plain?.task).toBeUndefined();
  });

  it("returns zero when reconciling an empty session state", async () => {
    const { reconcileOrphanedRunningTasks } = await loadTerminalSessionState();

    await expect(reconcileOrphanedRunningTasks()).resolves.toBe(0);
  });
  it("transferPanelOwnership CAS moves panel between window records and flushes", async () => {
    const {
      getTransferSession,
      readTerminalPanelSession,
      rollbackTransferPanelOwnership,
      transferPanelOwnership,
      updateTerminalPanelContext,
      updateTerminalPanelTask,
    } = await loadTerminalSessionState();

    const pier = context("/Users/dev/ABC/pier");
    await updateTerminalPanelContext("source-record", "terminal-1", pier);
    await updateTerminalPanelTask(
      "source-record",
      "terminal-1",
      taskMetadata({ runId: "run-1", status: "running" })
    );

    const view = await getTransferSession("source-record", "terminal-1");
    expect(view).toMatchObject({
      lifecycleId: "run-1",
      panelId: "terminal-1",
      recordId: "source-record",
    });

    const token = await transferPanelOwnership({
      expectedLifecycleId: "run-1",
      panelId: "terminal-1",
      sourceRecordId: "source-record",
      targetRecordId: "target-record",
    });

    await expect(
      readTerminalPanelSession("source-record", "terminal-1")
    ).resolves.toBeNull();
    await expect(
      readTerminalPanelSession("target-record", "terminal-1")
    ).resolves.toMatchObject({
      context: pier,
      task: { runId: "run-1", status: "running" },
    });

    await rollbackTransferPanelOwnership(token);
    await expect(
      readTerminalPanelSession("source-record", "terminal-1")
    ).resolves.toMatchObject({ task: { runId: "run-1" } });
    await expect(
      readTerminalPanelSession("target-record", "terminal-1")
    ).resolves.toBeNull();
  });

  it("transferPanelOwnership rejects lifecycle mismatch and target conflicts", async () => {
    const mod = await loadTerminalSessionState();
    const pier = context("/Users/dev/ABC/pier");
    await mod.updateTerminalPanelContext("source-record", "terminal-1", pier);
    await mod.updateTerminalPanelTask(
      "source-record",
      "terminal-1",
      taskMetadata({ runId: "run-1", status: "running" })
    );
    await mod.updateTerminalPanelContext("target-record", "terminal-1", pier);

    await expect(
      mod.transferPanelOwnership({
        expectedLifecycleId: "other-run",
        panelId: "terminal-1",
        sourceRecordId: "source-record",
        targetRecordId: "target-record",
      })
    ).rejects.toMatchObject({ code: "lifecycle_mismatch" });

    await expect(
      mod.transferPanelOwnership({
        panelId: "terminal-1",
        sourceRecordId: "source-record",
        targetRecordId: "target-record",
      })
    ).rejects.toMatchObject({ code: "target_conflict" });

    expect(mod.TerminalPanelOwnershipConflictError).toBeTypeOf("function");
  });

  it("allows empty lifecycleId for shell sessions during ownership transfer", async () => {
    const {
      readTerminalPanelSession,
      transferPanelOwnership,
      updateTerminalPanelContext,
    } = await loadTerminalSessionState();

    const pier = context("/Users/dev/ABC/pier");
    await updateTerminalPanelContext("source-record", "shell-1", pier);

    await transferPanelOwnership({
      expectedLifecycleId: "",
      panelId: "shell-1",
      sourceRecordId: "source-record",
      targetRecordId: "target-record",
    });

    await expect(
      readTerminalPanelSession("target-record", "shell-1")
    ).resolves.toMatchObject({ context: pier });
  });

  it("ensureTerminalPanelSession materializes an entry without clobbering metadata", async () => {
    const {
      ensureTerminalPanelSession,
      readTerminalPanelSession,
      transferPanelOwnership,
      updateTerminalPanelContext,
    } = await loadTerminalSessionState();

    // Bare entry: metadata-less live terminal becomes transferable.
    await ensureTerminalPanelSession("record-a", "shell-bare");
    await expect(
      readTerminalPanelSession("record-a", "shell-bare")
    ).resolves.toMatchObject({ updatedAt: expect.any(String) });

    await transferPanelOwnership({
      expectedLifecycleId: "",
      panelId: "shell-bare",
      sourceRecordId: "record-a",
      targetRecordId: "record-b",
    });
    await expect(
      readTerminalPanelSession("record-b", "shell-bare")
    ).resolves.not.toBeNull();

    // Ensure after metadata write is a no-op.
    const pier = context("/Users/dev/ABC/pier");
    await updateTerminalPanelContext("record-a", "shell-keep", pier);
    await ensureTerminalPanelSession("record-a", "shell-keep");
    await expect(
      readTerminalPanelSession("record-a", "shell-keep")
    ).resolves.toMatchObject({ context: pier });
  });
});
