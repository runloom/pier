import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as TerminalSessionStateModule from "@main/state/terminal-session-state.ts";
import type { TerminalAgentPanelMetadata } from "@shared/contracts/terminal.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadTerminalSessionState(): Promise<
  typeof TerminalSessionStateModule
> {
  return await import("@main/state/terminal-session-state.ts");
}

function pinnedResumeAgent(
  overrides: Partial<TerminalAgentPanelMetadata> = {}
): TerminalAgentPanelMetadata {
  return {
    agentId: "claude",
    launch: { agentId: "claude", command: "claude", cwd: "/repo" },
    resume: {
      capturedAt: 1,
      sessionId: "sess-old",
      source: "hook",
    },
    restore: { resumePending: true, spawnGeneration: 2 },
    startedAt: 1,
    status: "running",
    ...overrides,
  };
}

describe("resume pin latch", () => {
  let userDataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    userDataDir = await mkdtemp(join(tmpdir(), "pier-resume-pin-"));
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

  it("rejects a different SessionStart id while resumePending", async () => {
    const {
      readTerminalPanelSession,
      updateTerminalPanelAgent,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    await updateTerminalPanelAgent(
      "record-main",
      "terminal-1",
      pinnedResumeAgent()
    );
    await expect(
      updateTerminalPanelAgentResume("record-main", "terminal-1", {
        agentId: "claude",
        capturedAt: 10,
        sessionId: "sess-new",
        source: "hook",
      })
    ).resolves.toBe("pinned");
    const session = await readTerminalPanelSession("record-main", "terminal-1");
    expect(session?.agent?.resume?.sessionId).toBe("sess-old");
    expect(session?.agent?.restore?.resumePending).toBe(true);
  });

  it.each([
    "running",
    "pending",
  ])("SessionEnd cannot overwrite a newer %s resume key", async (phase) => {
    const {
      ensureTerminalPanelSession,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    if (phase === "running") {
      await updateTerminalPanelAgent(
        "record-main",
        "terminal-1",
        pinnedResumeAgent({
          restore: { spawnGeneration: 2 },
        })
      );
    } else {
      await ensureTerminalPanelSession("record-main", "terminal-1");
    }
    await updateTerminalPanelAgentResume(
      "record-main",
      "terminal-1",
      {
        agentId: "claude",
        capturedAt: 10,
        sessionId: "sess-current",
        source: "hook",
      },
      { unlockRotation: true }
    );

    await expect(
      updateTerminalPanelAgentResume(
        "record-main",
        "terminal-1",
        {
          agentId: "claude",
          capturedAt: 20,
          sessionId: "sess-old",
          source: "hook",
        },
        { preserveExistingSession: true }
      )
    ).resolves.toBe("pinned");

    if (phase === "pending") {
      const { resume: _resume, ...agent } = pinnedResumeAgent({
        restore: { spawnGeneration: 2 },
      });
      await updateTerminalPanelAgent("record-main", "terminal-1", agent);
    }
    expect(
      (await readTerminalPanelSession("record-main", "terminal-1"))?.agent
        ?.resume?.sessionId
    ).toBe("sess-current");
  });

  it("SessionEnd may supply a missing resume key", async () => {
    const { updateTerminalPanelAgent, updateTerminalPanelAgentResume } =
      await loadTerminalSessionState();
    const { resume: _resume, ...agent } = pinnedResumeAgent({
      restore: { spawnGeneration: 2 },
    });
    await updateTerminalPanelAgent("record-main", "terminal-1", agent);
    await expect(
      updateTerminalPanelAgentResume(
        "record-main",
        "terminal-1",
        {
          agentId: "claude",
          capturedAt: 10,
          sessionId: "sess-final",
          source: "hook",
        },
        { preserveExistingSession: true }
      )
    ).resolves.toBe("applied");
  });

  it("clears resumePending on matching session id", async () => {
    const {
      readTerminalPanelSession,
      updateTerminalPanelAgent,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    await updateTerminalPanelAgent(
      "record-main",
      "terminal-1",
      pinnedResumeAgent()
    );
    await expect(
      updateTerminalPanelAgentResume("record-main", "terminal-1", {
        agentId: "claude",
        capturedAt: 10,
        sessionId: "sess-old",
        source: "hook",
      })
    ).resolves.toBe("applied");
    const session = await readTerminalPanelSession("record-main", "terminal-1");
    expect(session?.agent?.resume?.sessionId).toBe("sess-old");
    expect(session?.agent?.restore?.resumePending).toBeUndefined();
    expect(session?.agent?.restore?.spawnGeneration).toBe(2);
    await expect(
      updateTerminalPanelAgentResume("record-main", "terminal-1", {
        agentId: "claude",
        capturedAt: 11,
        sessionId: "sess-rotated",
        source: "hook",
      })
    ).resolves.toBe("applied");
    await expect(
      readTerminalPanelSession("record-main", "terminal-1")
    ).resolves.toMatchObject({
      agent: { resume: { sessionId: "sess-rotated" } },
    });
  });

  it("PromptSubmit unlocks rotation to a new id", async () => {
    const {
      readTerminalPanelSession,
      updateTerminalPanelAgent,
      updateTerminalPanelAgentResume,
    } = await loadTerminalSessionState();
    await updateTerminalPanelAgent(
      "record-main",
      "terminal-1",
      pinnedResumeAgent()
    );
    await expect(
      updateTerminalPanelAgentResume(
        "record-main",
        "terminal-1",
        {
          agentId: "claude",
          capturedAt: 10,
          sessionId: "sess-live",
          source: "hook",
        },
        { unlockRotation: true }
      )
    ).resolves.toBe("applied");
    const session = await readTerminalPanelSession("record-main", "terminal-1");
    expect(session?.agent?.resume?.sessionId).toBe("sess-live");
    expect(session?.agent?.restore?.resumePending).toBeUndefined();
  });

  it("records resumePending on resume spawn generation", async () => {
    const {
      readTerminalPanelSession,
      recordTerminalPanelAgentSpawnGeneration,
      updateTerminalPanelAgent,
    } = await loadTerminalSessionState();
    await updateTerminalPanelAgent("record-main", "terminal-1", {
      agentId: "claude",
      launch: { agentId: "claude", command: "claude", cwd: "/repo" },
      resume: {
        capturedAt: 1,
        sessionId: "sess-old",
        source: "hook",
      },
      restore: { cause: "host-teardown", detachedAt: 10 },
      startedAt: 1,
      status: "running",
    });
    await recordTerminalPanelAgentSpawnGeneration(
      "record-main",
      "terminal-1",
      2,
      { resumePending: true }
    );
    const session = await readTerminalPanelSession("record-main", "terminal-1");
    expect(session?.agent?.restore).toEqual({
      resumePending: true,
      spawnGeneration: 2,
    });
    expect(session?.agent?.resume?.sessionId).toBe("sess-old");
  });

  it("marks resume-failed on exit while pending and does not heal on read", async () => {
    const {
      patchTerminalPanelAgentStatus,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
    } = await loadTerminalSessionState();
    const { healHostTeardownAgentOnRead } = await import(
      "@main/state/terminal-session-heal.ts"
    );
    await updateTerminalPanelAgent(
      "record-main",
      "terminal-1",
      pinnedResumeAgent()
    );
    const patched = await patchTerminalPanelAgentStatus(
      "record-main",
      "terminal-1",
      { finishedAt: 50, status: "exited" }
    );
    expect(patched).toBe(true);
    const session = await readTerminalPanelSession("record-main", "terminal-1");
    expect(session?.agent?.status).toBe("exited");
    expect(session?.agent?.restore?.cause).toBe("resume-failed");
    expect(session?.agent?.resume?.sessionId).toBe("sess-old");
    expect(session?.agent?.restore?.resumePending).toBeUndefined();
    expect(healHostTeardownAgentOnRead(session?.agent)?.status).toBe("exited");
  });

  it("does not heal resume-failed rows that still have detachedAt", async () => {
    const { healHostTeardownAgentOnRead } = await import(
      "@main/state/terminal-session-heal.ts"
    );
    const healed = healHostTeardownAgentOnRead({
      agentId: "claude",
      exitCode: 0,
      finishedAt: 20,
      launch: { agentId: "claude", command: "claude", cwd: "/repo" },
      resume: { capturedAt: 1, sessionId: "sess-old", source: "hook" },
      restore: {
        cause: "resume-failed",
        detachedAt: 10,
        spawnGeneration: 2,
      },
      startedAt: 1,
      status: "exited",
    });
    expect(healed?.status).toBe("exited");
    expect(healed?.restore?.cause).toBe("resume-failed");
  });
});
