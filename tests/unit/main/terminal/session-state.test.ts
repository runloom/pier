import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as TerminalSessionStateModule from "@main/state/terminal-session-state.ts";
import type * as TerminalSessionTitleModule from "@main/state/terminal-session-title.ts";
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
  typeof TerminalSessionStateModule &
    typeof TerminalSessionTitleModule &
    typeof TerminalSessionTransferModule
> {
  // Dynamic import is required because each test resets modules and mocks electron app.getPath before this state module resolves userData.
  const state = await import("@main/state/terminal-session-state.ts");
  const title = await import("@main/state/terminal-session-title.ts");
  const transfer = await import("@main/state/terminal-session-transfer.ts");
  return { ...state, ...title, ...transfer };
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

  it("returns the canonical higher-rank title when a lower-rank write is rejected", async () => {
    const { ensureTerminalPanelSession, setTerminalPanelSessionTitle } =
      await loadTerminalSessionState();
    await ensureTerminalPanelSession("main", "terminal-title");
    await setTerminalPanelSessionTitle("main", "terminal-title", {
      sessionId: "session-1",
      source: "user",
      title: "用户标题",
    });

    await expect(
      setTerminalPanelSessionTitle("main", "terminal-title", {
        sessionId: "session-1",
        source: "provider",
        title: "自动标题",
      })
    ).resolves.toEqual({
      applied: false,
      ok: true,
      sessionId: "session-1",
      source: "user",
      title: "用户标题",
    });
  });

  it("clears a title when SessionStart switches to a different known session", async () => {
    const {
      ensureTerminalPanelSession,
      readTerminalPanelSession,
      reconcileTerminalPanelSessionTitleScope,
      setTerminalPanelSessionTitle,
    } = await loadTerminalSessionState();
    await ensureTerminalPanelSession("main", "terminal-title");
    await setTerminalPanelSessionTitle("main", "terminal-title", {
      sessionId: "session-old",
      source: "provider",
      title: "旧会话",
    });

    await expect(
      reconcileTerminalPanelSessionTitleScope(
        "main",
        "terminal-title",
        "session-new"
      )
    ).resolves.toEqual({ applied: true, ok: true });
    await expect(
      readTerminalPanelSession("main", "terminal-title")
    ).resolves.not.toMatchObject({
      sessionTitle: expect.anything(),
      sessionTitleSource: expect.anything(),
    });

    await expect(
      setTerminalPanelSessionTitle("main", "terminal-title", {
        sessionId: "session-new",
        source: "provider",
        title: "新会话",
      })
    ).resolves.toMatchObject({
      applied: true,
      sessionId: "session-new",
      source: "provider",
      title: "新会话",
    });
  });

  it("binds a legacy unscoped title to the first reliable session without rewriting it", async () => {
    const {
      ensureTerminalPanelSession,
      reconcileTerminalPanelSessionTitleScope,
      setTerminalPanelSessionTitle,
    } = await loadTerminalSessionState();
    await ensureTerminalPanelSession("main", "terminal-legacy");
    await setTerminalPanelSessionTitle("main", "terminal-legacy", {
      source: "user",
      title: "历史标题",
    });

    await expect(
      reconcileTerminalPanelSessionTitleScope(
        "main",
        "terminal-legacy",
        "session-1"
      )
    ).resolves.toEqual({
      applied: true,
      ok: true,
      sessionId: "session-1",
      source: "user",
      title: "历史标题",
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
    ).resolves.toBe("applied");

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

  it("stashes hook resume until agent metadata is written", async () => {
    const {
      clearPendingAgentResumesForTests,
      ensureTerminalPanelSession,
      peekPendingAgentResumeForTests,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    clearPendingAgentResumesForTests();

    // Panel row must exist before stash (no ghost-panel pending).
    await ensureTerminalPanelSession("main", "terminal-codex");

    await expect(
      updateTerminalPanelAgentResume("main", "terminal-codex", {
        agentId: "codex",
        capturedAt: 1_772_000_001_000,
        sessionId: "codex-session-1",
        source: "hook",
      })
    ).resolves.toBe("pending");
    expect(
      peekPendingAgentResumeForTests("main", "terminal-codex")?.sessionId
    ).toBe("codex-session-1");

    await updateTerminalPanelAgent("main", "terminal-codex", {
      agentId: "codex",
      launch: {
        agentId: "codex",
        command: "codex --dangerously-bypass-approvals-and-sandbox",
        cwd: "/repo",
      },
      startedAt: 1_772_000_000_000,
      status: "running",
    });

    await expect(
      readTerminalPanelSession("main", "terminal-codex")
    ).resolves.toMatchObject({
      agent: {
        agentId: "codex",
        resume: {
          sessionId: "codex-session-1",
          source: "hook",
        },
        status: "running",
      },
    });
    expect(
      peekPendingAgentResumeForTests("main", "terminal-codex")
    ).toBeUndefined();
  });

  it("rejects resume stash when panel row is missing", async () => {
    const {
      clearPendingAgentResumesForTests,
      peekPendingAgentResumeForTests,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    clearPendingAgentResumesForTests();

    await expect(
      updateTerminalPanelAgentResume("main", "no-such-panel", {
        agentId: "codex",
        capturedAt: 1,
        sessionId: "ghost",
        source: "hook",
      })
    ).resolves.toBe("rejected");
    expect(
      peekPendingAgentResumeForTests("main", "no-such-panel")
    ).toBeUndefined();
  });

  it("rekeys pending from source to target on ownership transfer", async () => {
    const {
      clearPendingAgentResumesForTests,
      ensureTerminalPanelSession,
      peekPendingAgentResumeForTests,
      readTerminalPanelSession,
      transferPanelOwnership,
      updateTerminalPanelAgent,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    clearPendingAgentResumesForTests();

    await ensureTerminalPanelSession("src-win", "terminal-1");
    await updateTerminalPanelAgentResume("src-win", "terminal-1", {
      agentId: "codex",
      capturedAt: 50,
      sessionId: "from-source",
      source: "hook",
    });
    await updateTerminalPanelAgent("src-win", "terminal-1", {
      agentId: "codex",
      launch: { agentId: "codex", command: "codex", cwd: "/repo" },
      startedAt: 1,
      status: "running",
    });
    // Drop resume so rekeyed pending (if any leftover) matters less; force
    // pending by stashing after clear-path: write second pending before agent
    // was applied already consumed it. Instead put pending on target orphan
    // and source after agent already applied — re-stash via ensure empty resume
    // by re-writing agent without resume then stashing again is complex.
    // Source pending after apply is empty; stash on a panel that only has
    // agent on source without resume:
    await updateTerminalPanelAgent("src-win", "terminal-1", {
      agentId: "codex",
      launch: { agentId: "codex", command: "codex", cwd: "/repo" },
      startedAt: 1,
      status: "running",
    });
    // Agent write without resume field replaces agent — no resume, pending empty.
    // Stash pending again for transfer migration test:
    await updateTerminalPanelAgentResume("src-win", "terminal-1", {
      agentId: "codex",
      capturedAt: 99,
      sessionId: "migrate-me",
      source: "hook",
    });
    expect(
      (await readTerminalPanelSession("src-win", "terminal-1"))?.agent?.resume
        ?.sessionId
    ).toBe("migrate-me");

    // Put orphan pending on target key only (same panel id, different window)
    // by ensuring a row, stashing, then removing agent without clear? Simpler:
    // ensure target has no panel; rekey only moves source→target.
    await transferPanelOwnership({
      panelId: "terminal-1",
      sourceRecordId: "src-win",
      targetRecordId: "dst-win",
    });

    expect(
      peekPendingAgentResumeForTests("src-win", "terminal-1")
    ).toBeUndefined();
    await expect(
      readTerminalPanelSession("dst-win", "terminal-1")
    ).resolves.toMatchObject({
      agent: {
        agentId: "codex",
        resume: { sessionId: "migrate-me" },
        status: "running",
      },
    });
  });

  it("merges pending into agent on detach and clears window pending", async () => {
    const {
      clearPendingAgentResumesForTests,
      detachAgentsForWindow,
      ensureTerminalPanelSession,
      peekPendingAgentResumeForTests,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    clearPendingAgentResumesForTests();

    await ensureTerminalPanelSession("main", "terminal-1");
    await updateTerminalPanelAgentResume("main", "terminal-1", {
      agentId: "codex",
      capturedAt: 10,
      sessionId: "detach-id",
      source: "hook",
    });
    await updateTerminalPanelAgent("main", "terminal-1", {
      agentId: "codex",
      launch: { agentId: "codex", command: "codex", cwd: "/repo" },
      startedAt: 1,
      status: "running",
    });
    // Clear resume from agent to leave only pending: re-write agent without
    // resume then stash again
    await updateTerminalPanelAgent("main", "terminal-1", {
      agentId: "codex",
      launch: { agentId: "codex", command: "codex", cwd: "/repo" },
      startedAt: 1,
      status: "running",
    });
    await updateTerminalPanelAgentResume("main", "terminal-1", {
      agentId: "codex",
      capturedAt: 20,
      sessionId: "detach-id-2",
      source: "hook",
    });

    await detachAgentsForWindow("main");

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      agent: {
        resume: { sessionId: "detach-id-2" },
        status: "running",
        restore: { detachedAt: expect.any(Number) },
      },
    });
    expect(
      peekPendingAgentResumeForTests("main", "terminal-1")
    ).toBeUndefined();
  });

  it("does not let older pending overwrite a newer applied resume", async () => {
    const {
      clearPendingAgentResumesForTests,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    clearPendingAgentResumesForTests();

    await updateTerminalPanelAgent("main", "terminal-1", {
      agentId: "codex",
      launch: { agentId: "codex", command: "codex", cwd: "/repo" },
      startedAt: 1,
      status: "running",
    });
    await expect(
      updateTerminalPanelAgentResume("main", "terminal-1", {
        agentId: "codex",
        capturedAt: 2000,
        sessionId: "newer-session",
        source: "hook",
      })
    ).resolves.toBe("applied");

    await expect(
      updateTerminalPanelAgentResume("main", "terminal-1", {
        agentId: "codex",
        capturedAt: 1000,
        sessionId: "older-session",
        source: "hook",
      })
    ).resolves.toBe("rejected");

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      agent: { resume: { sessionId: "newer-session", capturedAt: 2000 } },
    });
  });

  it("keeps newer pending when older hook arrives first for stash", async () => {
    const {
      clearPendingAgentResumesForTests,
      ensureTerminalPanelSession,
      peekPendingAgentResumeForTests,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    clearPendingAgentResumesForTests();
    await ensureTerminalPanelSession("main", "terminal-x");

    await updateTerminalPanelAgentResume("main", "terminal-x", {
      agentId: "codex",
      capturedAt: 2000,
      sessionId: "newer",
      source: "hook",
    });
    await updateTerminalPanelAgentResume("main", "terminal-x", {
      agentId: "codex",
      capturedAt: 1000,
      sessionId: "older",
      source: "hook",
    });
    expect(
      peekPendingAgentResumeForTests("main", "terminal-x")?.sessionId
    ).toBe("newer");
  });

  it("clears pending when panel session is removed", async () => {
    const {
      clearPendingAgentResumesForTests,
      ensureTerminalPanelSession,
      peekPendingAgentResumeForTests,
      removeTerminalPanelSession,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    clearPendingAgentResumesForTests();
    await ensureTerminalPanelSession("main", "terminal-gone");

    await updateTerminalPanelAgentResume("main", "terminal-gone", {
      agentId: "codex",
      capturedAt: 1,
      sessionId: "orphan",
      source: "hook",
    });
    expect(
      peekPendingAgentResumeForTests("main", "terminal-gone")?.sessionId
    ).toBe("orphan");

    await removeTerminalPanelSession("main", "terminal-gone");
    expect(
      peekPendingAgentResumeForTests("main", "terminal-gone")
    ).toBeUndefined();
  });

  it("clears mismatched pending when agent metadata is written for another agent", async () => {
    const {
      clearPendingAgentResumesForTests,
      peekPendingAgentResumeForTests,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    clearPendingAgentResumesForTests();

    await updateTerminalPanelAgentResume("main", "terminal-1", {
      agentId: "codex",
      capturedAt: 1,
      sessionId: "codex-id",
      source: "hook",
    });
    await updateTerminalPanelAgent("main", "terminal-1", {
      agentId: "claude",
      launch: { agentId: "claude", command: "claude", cwd: "/repo" },
      startedAt: 1,
      status: "running",
    });
    expect(
      peekPendingAgentResumeForTests("main", "terminal-1")
    ).toBeUndefined();
    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.not.toHaveProperty("agent.resume");
  });

  it("treats same sessionId as applied without changing capturedAt", async () => {
    const {
      clearPendingAgentResumesForTests,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    clearPendingAgentResumesForTests();

    await updateTerminalPanelAgent("main", "terminal-1", {
      agentId: "codex",
      launch: { agentId: "codex", command: "codex", cwd: "/repo" },
      startedAt: 1,
      status: "running",
    });
    await updateTerminalPanelAgentResume("main", "terminal-1", {
      agentId: "codex",
      capturedAt: 100,
      sessionId: "same-id",
      source: "hook",
    });
    await expect(
      updateTerminalPanelAgentResume("main", "terminal-1", {
        agentId: "codex",
        capturedAt: 999,
        sessionId: "same-id",
        source: "hook",
      })
    ).resolves.toBe("applied");
    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      agent: { resume: { sessionId: "same-id", capturedAt: 100 } },
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
    ).resolves.toBe("rejected");

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

  it("migrates legacy agent success tabs on disk", async () => {
    const {
      migrateLegacyAgentSuccessTabs,
      patchTerminalPanelTab,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
      updateTerminalPanelTab,
    } = await loadTerminalSessionState();
    await updateTerminalPanelAgent("main", "terminal-legacy", {
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
    await updateTerminalPanelTab("main", "terminal-legacy", {
      icon: { id: "agent:claude" },
      state: {
        colorToken: "success",
        label: "Exited",
        status: "succeeded",
      },
      title: "pier",
    });
    // Direct tab patch can reintroduce success after clean exit — migrate cleans.
    await patchTerminalPanelTab("main", "terminal-legacy", {
      state: {
        colorToken: "success",
        label: "Exited",
        status: "succeeded",
      },
    });

    await expect(migrateLegacyAgentSuccessTabs()).resolves.toBeGreaterThan(0);
    const after = await readTerminalPanelSession("main", "terminal-legacy");
    expect(after?.tab?.state).toBeUndefined();
    expect(after?.tab?.icon?.id).toBe("agent:claude");
  });

  it("does not mark clean agent exit as succeeded (no green check)", async () => {
    const {
      patchTerminalPanelAgentStatus,
      patchTerminalPanelTab,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
      updateTerminalPanelTab,
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
    await updateTerminalPanelTab("main", "terminal-1", {
      icon: { id: "agent:claude" },
      state: { label: "Running", status: "running" },
      title: "pier",
    });

    await expect(
      patchTerminalPanelAgentStatus("main", "terminal-1", {
        exitCode: 0,
        finishedAt: 1_772_000_001_000,
        status: "exited",
      })
    ).resolves.toBe(true);

    const afterClean = await readTerminalPanelSession("main", "terminal-1");
    expect(afterClean?.agent?.status).toBe("exited");
    expect(afterClean?.agent?.exitCode).toBe(0);
    expect(afterClean?.tab?.state).toBeUndefined();
    expect(afterClean?.tab?.icon?.id).toBe("agent:claude");
    expect(afterClean?.tab?.title).toBe("pier");

    // Legacy disk: success chrome must be sanitized on read.
    await patchTerminalPanelTab("main", "terminal-1", {
      state: {
        colorToken: "success",
        label: "Exited",
        status: "succeeded",
      },
    });
    const afterLegacy = await readTerminalPanelSession("main", "terminal-1");
    expect(afterLegacy?.tab?.state).toBeUndefined();
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
