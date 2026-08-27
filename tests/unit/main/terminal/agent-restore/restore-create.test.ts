import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  nextAgentSpawnGeneration,
  resolveCreateTerminalLaunch,
  withAgentSpawnGenerationEnv,
} from "@main/ipc/terminal/create-launch.ts";
import {
  agentRestoreCreateFields,
  resolveAgentResumeLaunch,
} from "@main/services/agents/resume-adapters.ts";
import {
  registerLaunchResumeHint,
  terminalLaunchRegistry,
} from "@main/state/terminal-launch-state.ts";
import { healHostTeardownAgentOnRead } from "@main/state/terminal-session-heal.ts";
import type {
  CreateTerminalArgs,
  TerminalAgentPanelMetadata,
} from "@shared/contracts/terminal.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createArgs(
  overrides: Partial<CreateTerminalArgs> = {}
): CreateTerminalArgs {
  return {
    font: { family: ["Monaco"], size: 13 },
    frame: { height: 300, width: 400, x: 0, y: 0 },
    panelId: "terminal-1",
    presentationId: 1,
    ...overrides,
  };
}

function screenshotExitedAgent(
  overrides: Partial<TerminalAgentPanelMetadata> = {}
): TerminalAgentPanelMetadata {
  return {
    agentId: "omp",
    exitCode: 0,
    finishedAt: 11,
    launch: { agentId: "omp", command: "omp", cwd: "/repo" },
    resume: { capturedAt: 1, sessionId: "sess-1", source: "hook" },
    restore: { detachedAt: 10 },
    startedAt: 1,
    status: "exited",
    ...overrides,
  };
}

describe("host-teardown restore create", () => {
  it("heals a screenshot row then resumes omp --resume without rewriting launch.command", () => {
    const healed = healHostTeardownAgentOnRead(screenshotExitedAgent());
    expect(healed?.status).toBe("running");
    expect(healed?.restore?.cause).toBe("host-teardown");
    expect(healed?.launch.command).toBe("omp");

    const result = resolveCreateTerminalLaunch(createArgs(), {
      agent: healed,
      updatedAt: "2026-08-26T00:00:00.000Z",
    });
    expect(result.restoredAgentLaunch).toBe(true);
    expect(result.restoredAgent?.launch.command).toBe("omp");

    const restored = result.restoredAgent;
    if (!restored) {
      throw new Error("expected restored agent");
    }
    const resume = resolveAgentResumeLaunch({
      agent: restored,
      cwd: "/repo",
    });
    expect(resume.resumed).toBe(true);
    if (!resume.resumed) {
      throw new Error("expected resumed launch");
    }
    expect(resume.launch.command).toContain("--resume");
    expect(resume.launch.command).toContain("sess-1");
    expect(restored.launch.command).not.toContain("--resume");
  });

  it("heals when finishedAt is missing", () => {
    const healed = healHostTeardownAgentOnRead(
      screenshotExitedAgent({ finishedAt: undefined })
    );
    expect(healed?.status).toBe("running");
    expect(healed?.restore?.cause).toBe("host-teardown");
  });

  it("does not heal a clean in-window exit without detachedAt", () => {
    const healed = healHostTeardownAgentOnRead(
      screenshotExitedAgent({ restore: undefined })
    );
    expect(healed?.status).toBe("exited");
  });

  it("does not heal a dirty exit even with detachedAt", () => {
    const healed = healHostTeardownAgentOnRead(
      screenshotExitedAgent({ exitCode: 1 })
    );
    expect(healed?.status).toBe("exited");
  });

  it("does not auto --continue omp on cold-start", () => {
    const fields = agentRestoreCreateFields({
      agentRestore: "cold-start",
      cwd: "/repo",
      restoredAgent: {
        agentId: "omp",
        launch: { agentId: "omp", command: "omp", cwd: "/repo" },
        startedAt: 1,
        status: "running",
      },
    });
    expect(fields.tryResumeLast).toBeUndefined();
    expect(fields.agentRestore).toBe("cold-start");
  });

  it("does not return tryResumeLast after a pin-id resume", () => {
    const fields = agentRestoreCreateFields({
      agentRestore: "resumed",
      cwd: "/repo",
      restoredAgent: screenshotExitedAgent(),
    });
    expect(fields.tryResumeLast).toBeUndefined();
  });

  it("injects spawn generation and window record id into hook env", () => {
    expect(
      withAgentSpawnGenerationEnv({}, "omp", 2, "record-main")
    ).toMatchObject({
      PIER_AGENT_SPAWN_GENERATION: "2",
      PIER_WINDOW_RECORD_ID: "record-main",
    });
    expect(nextAgentSpawnGeneration({ restore: { spawnGeneration: 2 } })).toBe(
      3
    );
  });
});

describe("persistInitialTerminalAgent restore", () => {
  let userDataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    userDataDir = await mkdtemp(join(tmpdir(), "pier-restore-create-"));
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

  it("persists the original command and keeps host-teardown cause before create", async () => {
    const { persistInitialTerminalAgent } = await import(
      "@main/ipc/terminal/initial-session.ts"
    );
    const { readTerminalPanelSession } = await import(
      "@main/state/terminal-session-state.ts"
    );
    const existing = healHostTeardownAgentOnRead(screenshotExitedAgent());
    if (!existing) {
      throw new Error("expected healed agent");
    }
    await persistInitialTerminalAgent(
      "record-main",
      "terminal-1",
      "omp",
      { agentId: "omp", command: "omp --resume sess-1", cwd: "/repo" },
      {
        existing,
        restoredAgentLaunch: true,
      }
    );
    const session = await readTerminalPanelSession("record-main", "terminal-1");
    expect(session?.agent?.launch.command).toBe("omp");
    expect(session?.agent?.launch.command).not.toContain("--resume");
    expect(session?.agent?.restore?.cause).toBe("host-teardown");
    expect(session?.agent?.resume?.sessionId).toBe("sess-1");
    expect(session?.agent?.status).toBe("running");
  });
});

describe("overlay resume hint", () => {
  it("does not synthesize an agent when the hint is absent (new session)", () => {
    const launchId = terminalLaunchRegistry.register({
      agentId: "omp",
      command: "omp",
      cwd: "/repo",
    });
    const result = resolveCreateTerminalLaunch(createArgs({ launchId }), null);
    expect(result.restoredAgentLaunch).toBeUndefined();
    expect(result.restoredAgent).toBeUndefined();
    expect(result.launchAgentId).toBe("omp");
  });

  it("consumes the hint with the launch id", () => {
    const launchId = terminalLaunchRegistry.register({
      agentId: "omp",
      command: "omp",
      cwd: "/repo",
    });
    registerLaunchResumeHint(launchId, "sess-hint");
    expect(
      resolveCreateTerminalLaunch(createArgs({ launchId }), null).restoredAgent
        ?.resume?.sessionId
    ).toBe("sess-hint");
    terminalLaunchRegistry.consume(launchId);
    expect(
      resolveCreateTerminalLaunch(createArgs({ launchId }), null).restoredAgent
    ).toBeUndefined();
  });
});
