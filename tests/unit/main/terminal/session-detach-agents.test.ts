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

function runningAgent(
  overrides: Partial<TerminalAgentPanelMetadata> = {}
): TerminalAgentPanelMetadata {
  return {
    agentId: "claude",
    finishedAt: 1_772_000_001_000,
    exitCode: 0,
    launch: {
      agentId: "claude",
      command: "claude",
      cwd: "/repo",
    },
    resume: {
      capturedAt: 1_772_000_000_500,
      sessionId: "sess-running",
      source: "hook",
    },
    startedAt: 1_772_000_000_000,
    status: "running",
    ...overrides,
  };
}

describe("detachAgentsForWindow", () => {
  let userDataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    userDataDir = await mkdtemp(join(tmpdir(), "pier-terminal-detach-"));
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

  it("keeps running agents restorable and stamps detachedAt", async () => {
    const {
      detachAgentsForWindow,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
    } = await loadTerminalSessionState();

    await updateTerminalPanelAgent("record-main", "terminal-1", runningAgent());

    const before = Date.now();
    await detachAgentsForWindow("record-main");
    const after = Date.now();

    const session = await readTerminalPanelSession("record-main", "terminal-1");
    expect(session?.agent).toMatchObject({
      agentId: "claude",
      launch: {
        agentId: "claude",
        command: "claude",
        cwd: "/repo",
      },
      resume: {
        capturedAt: 1_772_000_000_500,
        sessionId: "sess-running",
        source: "hook",
      },
      startedAt: 1_772_000_000_000,
      status: "running",
    });
    expect(session?.agent?.exitCode).toBeUndefined();
    expect(session?.agent?.finishedAt).toBeUndefined();
    const detachedAt = session?.agent?.restore?.detachedAt;
    expect(typeof detachedAt).toBe("number");
    expect(detachedAt).toBeGreaterThanOrEqual(before);
    expect(detachedAt).toBeLessThanOrEqual(after);
    expect(session?.agent?.restore?.cause).toBe("host-teardown");
  });

  it("refuses exited patches after host-teardown even without another flush", async () => {
    const {
      detachAgentsForWindow,
      patchTerminalPanelAgentStatus,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
    } = await loadTerminalSessionState();

    await updateTerminalPanelAgent("record-main", "terminal-1", runningAgent());
    await detachAgentsForWindow("record-main");
    const patched = await patchTerminalPanelAgentStatus(
      "record-main",
      "terminal-1",
      { exitCode: 0, finishedAt: Date.now(), status: "exited" }
    );
    expect(patched).toBe(false);
    const session = await readTerminalPanelSession("record-main", "terminal-1");
    expect(session?.agent?.status).toBe("running");
    expect(session?.agent?.restore?.cause).toBe("host-teardown");
  });

  it("skips panels listed in skipPanelIds", async () => {
    const {
      detachAgentsForWindow,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
    } = await loadTerminalSessionState();

    await updateTerminalPanelAgent("record-main", "terminal-1", runningAgent());
    await updateTerminalPanelAgent(
      "record-main",
      "terminal-2",
      runningAgent({
        resume: { capturedAt: 1, sessionId: "other", source: "hook" },
      })
    );
    await detachAgentsForWindow("record-main", {
      skipPanelIds: ["terminal-1"],
    });

    await expect(
      readTerminalPanelSession("record-main", "terminal-1")
    ).resolves.toMatchObject({
      agent: { status: "running", resume: { sessionId: "sess-running" } },
    });
    expect(
      (await readTerminalPanelSession("record-main", "terminal-1"))?.agent
        ?.restore?.cause
    ).toBeUndefined();
    await expect(
      readTerminalPanelSession("record-main", "terminal-2")
    ).resolves.toMatchObject({
      agent: { restore: { cause: "host-teardown" }, status: "running" },
    });
  });

  it("leaves exited agents unchanged", async () => {
    const {
      detachAgentsForWindow,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
    } = await loadTerminalSessionState();

    const exited: TerminalAgentPanelMetadata = {
      agentId: "claude",
      exitCode: 1,
      finishedAt: 1_772_000_002_000,
      launch: {
        agentId: "claude",
        command: "claude",
        cwd: "/repo",
      },
      resume: {
        capturedAt: 1_772_000_000_500,
        sessionId: "sess-exited",
        source: "hook",
      },
      startedAt: 1_772_000_000_000,
      status: "exited",
    };
    await updateTerminalPanelAgent("record-main", "terminal-2", exited);
    await detachAgentsForWindow("record-main");

    await expect(
      readTerminalPanelSession("record-main", "terminal-2")
    ).resolves.toMatchObject({ agent: exited });
  });

  it("ignores empty record ids and unknown windows", async () => {
    const {
      detachAgentsForWindow,
      readTerminalPanelSession,
      updateTerminalPanelAgent,
    } = await loadTerminalSessionState();

    await updateTerminalPanelAgent(
      "record-main",
      "terminal-1",
      runningAgent({ finishedAt: undefined, exitCode: undefined })
    );

    await detachAgentsForWindow("");
    await detachAgentsForWindow("missing-record");

    await expect(
      readTerminalPanelSession("record-main", "terminal-1")
    ).resolves.toMatchObject({
      agent: {
        status: "running",
        resume: { sessionId: "sess-running" },
      },
    });
    await expect(
      readTerminalPanelSession("record-main", "terminal-1")
    ).resolves.toMatchObject({
      agent: expect.not.objectContaining({
        restore: expect.anything(),
      }),
    });
  });
});
