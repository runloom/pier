import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as TerminalSessionStateModule from "@main/state/terminal-session-state.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadTerminalSessionState(): Promise<
  typeof TerminalSessionStateModule
> {
  return await import("@main/state/terminal-session-state.ts");
}

describe("agent resume durability", () => {
  let userDataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    userDataDir = await mkdtemp(join(tmpdir(), "pier-resume-durable-"));
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

  it("flushes a new session id without waiting for the 500ms debounce", async () => {
    const { updateTerminalPanelAgent, updateTerminalPanelAgentResume } =
      await loadTerminalSessionState();
    await updateTerminalPanelAgent("record-main", "terminal-1", {
      agentId: "omp",
      launch: { agentId: "omp", command: "omp", cwd: "/repo" },
      startedAt: 1,
      status: "running",
    });
    await expect(
      updateTerminalPanelAgentResume("record-main", "terminal-1", {
        agentId: "omp",
        capturedAt: 10,
        sessionId: "sess-flush",
        source: "hook",
      })
    ).resolves.toBe("applied");
    const raw = await readFile(
      join(userDataDir, "terminal-session-state.json"),
      "utf8"
    );
    expect(raw).toContain("sess-flush");
  });

  it("does not flush again for the same session id", async () => {
    const { updateTerminalPanelAgent, updateTerminalPanelAgentResume } =
      await loadTerminalSessionState();
    const { ensureTerminalSessionStore } = await import(
      "@main/state/terminal-session-store.ts"
    );
    await updateTerminalPanelAgent("record-main", "terminal-1", {
      agentId: "omp",
      launch: { agentId: "omp", command: "omp", cwd: "/repo" },
      startedAt: 1,
      status: "running",
    });
    await updateTerminalPanelAgentResume("record-main", "terminal-1", {
      agentId: "omp",
      capturedAt: 10,
      sessionId: "sess-same",
      source: "hook",
    });
    const store = await ensureTerminalSessionStore();
    const flush = vi.spyOn(store, "flush");
    await expect(
      updateTerminalPanelAgentResume("record-main", "terminal-1", {
        agentId: "omp",
        capturedAt: 99,
        sessionId: "sess-same",
        source: "hook",
      })
    ).resolves.toBe("unchanged");
    expect(flush).not.toHaveBeenCalled();
  });

  it("pins the existing id after host-teardown until resume is confirmed", async () => {
    const {
      detachAgentsForWindow,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    await updateTerminalPanelAgent("record-main", "terminal-1", {
      agentId: "omp",
      launch: { agentId: "omp", command: "omp", cwd: "/repo" },
      resume: {
        capturedAt: 1,
        sessionId: "sess-pinned",
        source: "hook",
      },
      startedAt: 1,
      status: "running",
    });
    await detachAgentsForWindow("record-main");
    await expect(
      updateTerminalPanelAgentResume("record-main", "terminal-1", {
        agentId: "omp",
        capturedAt: 20,
        sessionId: "sess-after-detach",
        source: "hook",
      })
    ).resolves.toBe("pinned");
    await expect(
      readTerminalPanelSession("record-main", "terminal-1")
    ).resolves.toMatchObject({
      agent: {
        resume: { sessionId: "sess-pinned" },
        restore: { cause: "host-teardown" },
        status: "running",
      },
    });
  });

  it("applies the first hook id after host-teardown when none was pinned", async () => {
    const {
      detachAgentsForWindow,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    await updateTerminalPanelAgent("record-main", "terminal-1", {
      agentId: "omp",
      launch: { agentId: "omp", command: "omp", cwd: "/repo" },
      startedAt: 1,
      status: "running",
    });
    await detachAgentsForWindow("record-main");
    await expect(
      updateTerminalPanelAgentResume("record-main", "terminal-1", {
        agentId: "omp",
        capturedAt: 20,
        sessionId: "sess-first",
        source: "hook",
      })
    ).resolves.toBe("applied");
    await expect(
      readTerminalPanelSession("record-main", "terminal-1")
    ).resolves.toMatchObject({
      agent: {
        resume: { sessionId: "sess-first" },
        restore: { cause: "host-teardown" },
        status: "running",
      },
    });
  });

  it("rehydrates disk pendingResume after a store rebuild", async () => {
    const {
      clearPendingAgentResumesForTests,
      ensureTerminalPanelSession,
      flushTerminalSessionState,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    clearPendingAgentResumesForTests();
    await ensureTerminalPanelSession("record-main", "terminal-1");
    await expect(
      updateTerminalPanelAgentResume("record-main", "terminal-1", {
        agentId: "omp",
        capturedAt: 5,
        sessionId: "sess-pending",
        source: "hook",
      })
    ).resolves.toBe("pending");
    await flushTerminalSessionState();

    vi.resetModules();
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

    const reloaded = await loadTerminalSessionState();
    reloaded.clearPendingAgentResumesForTests();
    await reloaded.updateTerminalPanelAgent("record-main", "terminal-1", {
      agentId: "omp",
      launch: { agentId: "omp", command: "omp", cwd: "/repo" },
      startedAt: 1,
      status: "running",
    });
    await expect(
      reloaded.readTerminalPanelSession("record-main", "terminal-1")
    ).resolves.toMatchObject({
      agent: {
        resume: { sessionId: "sess-pending" },
        status: "running",
      },
    });
  });

  it("overlays disk pendingResume onto a running agent on read", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(userDataDir, "terminal-session-state.json"),
      `${JSON.stringify(
        {
          version: 1,
          windows: {
            "record-main": {
              panels: {
                "terminal-1": {
                  agent: {
                    agentId: "omp",
                    launch: { agentId: "omp", command: "omp", cwd: "/repo" },
                    startedAt: 1,
                    status: "running",
                  },
                  pendingResume: {
                    agentId: "omp",
                    capturedAt: 9,
                    sessionId: "sess-overlay",
                    source: "hook",
                  },
                  updatedAt: "2026-08-26T00:00:00.000Z",
                },
              },
            },
          },
        },
        null,
        2
      )}\n`
    );
    const { readTerminalPanelSession } = await loadTerminalSessionState();
    const session = await readTerminalPanelSession("record-main", "terminal-1");
    expect(session?.agent?.resume?.sessionId).toBe("sess-overlay");
    expect(session).not.toHaveProperty("pendingResume");
  });
});
