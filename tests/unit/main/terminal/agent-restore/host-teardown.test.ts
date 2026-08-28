import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentSessionEndedInForeground,
  markForegroundAgentCommandFinished,
  resetForegroundAgentCommandFinishedForTests,
} from "@main/services/foreground-activity/agent-session-ended.ts";
import { createForegroundActivityAggregator } from "@main/services/foreground-activity/aggregator.ts";
import type * as TerminalSessionStateModule from "@main/state/terminal-session-state.ts";
import type { TerminalAgentPanelMetadata } from "@shared/contracts/terminal.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadTerminalSessionState(): Promise<
  typeof TerminalSessionStateModule
> {
  return await import("@main/state/terminal-session-state.ts");
}

function runningAgent(): TerminalAgentPanelMetadata {
  return {
    agentId: "omp",
    launch: { agentId: "omp", command: "omp", cwd: "/repo" },
    resume: {
      capturedAt: 1,
      sessionId: "sess-1",
      source: "hook",
    },
    restore: { cause: "host-teardown", detachedAt: 10 },
    startedAt: 1,
    status: "running",
  };
}

describe("host-teardown read heal", () => {
  it("heals screenshot-shaped exited rows", async () => {
    const { healHostTeardownAgentOnRead } = await import(
      "@main/state/terminal-session-heal.ts"
    );
    const healed = healHostTeardownAgentOnRead({
      agentId: "omp",
      exitCode: 0,
      finishedAt: 11,
      launch: { agentId: "omp", command: "omp", cwd: "/repo" },
      resume: { capturedAt: 1, sessionId: "sess-1", source: "hook" },
      restore: { detachedAt: 10 },
      startedAt: 1,
      status: "exited",
    });
    expect(healed?.status).toBe("running");
    expect(healed?.restore?.cause).toBe("host-teardown");
    expect(healed?.exitCode).toBeUndefined();
  });
});

describe("host-teardown latch", () => {
  let userDataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    resetForegroundAgentCommandFinishedForTests();
    userDataDir = await mkdtemp(join(tmpdir(), "pier-host-teardown-"));
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
    resetForegroundAgentCommandFinishedForTests();
    await rm(userDataDir, { force: true, recursive: true });
  });

  it("heals screenshot rows on readSession", async () => {
    const { readTerminalPanelSession, updateTerminalPanelAgent } =
      await loadTerminalSessionState();
    await updateTerminalPanelAgent("record-main", "terminal-1", {
      agentId: "omp",
      exitCode: 0,
      finishedAt: 11,
      launch: { agentId: "omp", command: "omp", cwd: "/repo" },
      resume: { capturedAt: 1, sessionId: "sess-1", source: "hook" },
      restore: { detachedAt: 10 },
      startedAt: 1,
      status: "exited",
    });
    const session = await readTerminalPanelSession("record-main", "terminal-1");
    expect(session?.agent?.status).toBe("running");
    expect(session?.agent?.restore?.cause).toBe("host-teardown");
    expect(session?.agent?.launch.command).toBe("omp");
  });

  it("clears cause after recording spawn generation", async () => {
    const {
      readTerminalPanelSession,
      recordTerminalPanelAgentSpawnGeneration,
      updateTerminalPanelAgent,
    } = await loadTerminalSessionState();

    await updateTerminalPanelAgent("record-main", "terminal-1", runningAgent());
    await recordTerminalPanelAgentSpawnGeneration(
      "record-main",
      "terminal-1",
      2
    );
    const session = await readTerminalPanelSession("record-main", "terminal-1");
    expect(session?.agent?.restore).toEqual({ spawnGeneration: 2 });
    expect(session?.agent?.status).toBe("running");
  });

  it("treats command_finished as in-window session end", () => {
    markForegroundAgentCommandFinished("terminal-1", "7");
    expect(agentSessionEndedInForeground("terminal-1", "7", true)).toBe(true);
  });

  it("treats missing agent slot as in-window session end", () => {
    expect(agentSessionEndedInForeground("terminal-1", "7", false)).toBe(true);
  });

  it("keeps a live agent slot as not ended", () => {
    expect(agentSessionEndedInForeground("terminal-1", "7", true)).toBe(false);
  });

  it("counts a hidden agent-launch as presence", () => {
    const agg = createForegroundActivityAggregator({ now: () => 1 });
    try {
      agg.agentLaunched("7", "terminal-1", "omp");
      expect(agg.hasAgentPresence("terminal-1", "7")).toBe(true);
      expect(
        agentSessionEndedInForeground(
          "terminal-1",
          "7",
          agg.hasAgentPresence("terminal-1", "7")
        )
      ).toBe(false);
    } finally {
      agg.dispose();
    }
  });
});
