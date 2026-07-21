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

describe("retainTerminalPanelSessions", () => {
  let userDataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    userDataDir = await mkdtemp(join(tmpdir(), "pier-terminal-retain-"));
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

  it("deletes panels not in activePanelIds and keeps active ones", async () => {
    const {
      readTerminalPanelSession,
      retainTerminalPanelSessions,
      updateTerminalPanelAgent,
    } = await loadTerminalSessionState();

    await updateTerminalPanelAgent("record-main", "term-keep", runningAgent());
    await updateTerminalPanelAgent(
      "record-main",
      "term-orphan",
      runningAgent({
        resume: {
          capturedAt: 1_772_000_000_600,
          sessionId: "sess-orphan",
          source: "hook",
        },
      })
    );
    await updateTerminalPanelAgent(
      "record-other",
      "term-other",
      runningAgent({
        resume: {
          capturedAt: 1_772_000_000_700,
          sessionId: "sess-other",
          source: "hook",
        },
      })
    );

    await retainTerminalPanelSessions("record-main", ["term-keep"]);

    await expect(
      readTerminalPanelSession("record-main", "term-keep")
    ).resolves.toMatchObject({
      agent: { resume: { sessionId: "sess-running" }, status: "running" },
    });
    await expect(
      readTerminalPanelSession("record-main", "term-orphan")
    ).resolves.toBeNull();
    // Other windows are untouched.
    await expect(
      readTerminalPanelSession("record-other", "term-other")
    ).resolves.toMatchObject({
      agent: { resume: { sessionId: "sess-other" } },
    });
  });

  it("removes the window entry when no panels remain", async () => {
    const {
      readTerminalPanelSession,
      retainTerminalPanelSessions,
      updateTerminalPanelAgent,
    } = await loadTerminalSessionState();

    await updateTerminalPanelAgent("record-main", "term-gone", runningAgent());

    await retainTerminalPanelSessions("record-main", []);

    await expect(
      readTerminalPanelSession("record-main", "term-gone")
    ).resolves.toBeNull();
  });

  it("ignores empty record ids and unknown windows", async () => {
    const {
      readTerminalPanelSession,
      retainTerminalPanelSessions,
      updateTerminalPanelAgent,
    } = await loadTerminalSessionState();

    await updateTerminalPanelAgent("record-main", "term-keep", runningAgent());

    await retainTerminalPanelSessions("", ["term-keep"]);
    await retainTerminalPanelSessions("missing-record", ["term-keep"]);

    await expect(
      readTerminalPanelSession("record-main", "term-keep")
    ).resolves.toMatchObject({
      agent: { status: "running" },
    });
  });

  it("filters blank active panel ids", async () => {
    const {
      readTerminalPanelSession,
      retainTerminalPanelSessions,
      updateTerminalPanelAgent,
    } = await loadTerminalSessionState();

    await updateTerminalPanelAgent("record-main", "term-a", runningAgent());
    await updateTerminalPanelAgent(
      "record-main",
      "term-b",
      runningAgent({
        resume: {
          capturedAt: 1,
          sessionId: "b",
          source: "hook",
        },
      })
    );

    await retainTerminalPanelSessions("record-main", ["term-a", "", "  "]);

    await expect(
      readTerminalPanelSession("record-main", "term-a")
    ).resolves.toMatchObject({ agent: { status: "running" } });
    await expect(
      readTerminalPanelSession("record-main", "term-b")
    ).resolves.toBeNull();
  });
  it("respects lease predicate and does not drop leased panels", async () => {
    const {
      readTerminalPanelSession,
      retainTerminalPanelSessions,
      updateTerminalPanelAgent,
    } = await loadTerminalSessionState();

    await updateTerminalPanelAgent(
      "record-main",
      "term-leased",
      runningAgent()
    );
    await updateTerminalPanelAgent(
      "record-main",
      "term-drop",
      runningAgent({
        resume: { capturedAt: 1, sessionId: "x", source: "hook" },
      })
    );

    await retainTerminalPanelSessions("record-main", [], {
      isLeased: (panelId) => panelId === "term-leased",
    });

    await expect(
      readTerminalPanelSession("record-main", "term-leased")
    ).resolves.not.toBeNull();
    await expect(
      readTerminalPanelSession("record-main", "term-drop")
    ).resolves.toBeNull();
  });
});
