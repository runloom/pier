import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import { agentHookEventSchema } from "@shared/contracts/agent/session.ts";
import { describe, expect, it, vi } from "vitest";
import {
  type AgentHookEventSinks,
  handleObservedAgentHookEvent,
} from "../../../../src/main/ipc/foreground-activity/hook-pipeline.ts";
import { installAgentHooksEmitScript } from "../../../../src/main/services/agents/hooks-install.ts";
import { PIER_HOOK_COMMAND_GENERATION } from "../../../../src/main/services/agents/hooks-title-script.ts";
import { createForegroundActivityAggregator } from "../../../../src/main/services/foreground-activity/aggregator.ts";
import {
  agentEventTty,
  shouldRejectForeignTtyAgentEvent,
} from "../../../../src/main/services/foreground-activity/hook-event-origin.ts";

function v3Event(
  overrides: Partial<AgentHookEventPayloadV3> = {}
): AgentHookEventPayloadV3 {
  return {
    v: 3,
    kind: "agentEvent",
    agent: "cursor",
    event: "PromptSubmit",
    nativeEvent: "beforeSubmitPrompt",
    panelId: "p1",
    windowId: "1",
    ...overrides,
  } as AgentHookEventPayloadV3;
}

describe("hook event origin (ctty gate)", () => {
  it("accepts events without a tty field (legacy scripts / JS extensions)", () => {
    expect(
      shouldRejectForeignTtyAgentEvent({
        eventAgent: "cursor",
        eventTty: undefined,
        oscOwnedAgent: null,
      })
    ).toBe(false);
  });

  it("accepts any event with a real controlling terminal, matching or not", () => {
    for (const tty of ["ttys012", "ttys999", "pts/3"]) {
      expect(
        shouldRejectForeignTtyAgentEvent({
          eventAgent: "cursor",
          eventTty: tty,
          oscOwnedAgent: null,
        }),
        tty
      ).toBe(false);
    }
  });

  it("accepts ctty-less events when the panel command layer owns the agent", () => {
    expect(
      shouldRejectForeignTtyAgentEvent({
        eventAgent: "cursor",
        eventTty: "??",
        oscOwnedAgent: "cursor",
      })
    ).toBe(false);
  });

  it("rejects ctty-less events without an OSC-lit owner (GUI leak)", () => {
    for (const tty of ["??", "?"]) {
      expect(
        shouldRejectForeignTtyAgentEvent({
          eventAgent: "cursor",
          eventTty: tty,
          oscOwnedAgent: null,
        }),
        tty
      ).toBe(true);
    }
  });

  it("rejects ctty-less events when another agent owns the command layer", () => {
    expect(
      shouldRejectForeignTtyAgentEvent({
        eventAgent: "cursor",
        eventTty: "??",
        oscOwnedAgent: "claude",
      })
    ).toBe(true);
  });

  it("agentEventTty only reads the field from v3 payloads", () => {
    expect(agentEventTty(v3Event({ tty: "ttys012" }))).toBe("ttys012");
    expect(agentEventTty(v3Event())).toBeUndefined();
    expect(
      agentEventTty({
        v: 1,
        kind: "agentEvent",
        agent: "claude",
        event: "Stop",
        panelId: "p1",
        windowId: "1",
      } as never)
    ).toBeUndefined();
  });
});

describe("panelCommandOwnedAgent query", () => {
  it("returns the OSC-lit agent and deliberately ignores hook layers", () => {
    const aggregator = createForegroundActivityAggregator();
    expect(aggregator.panelCommandOwnedAgent("p1", "1")).toBeNull();

    // A hook layer alone (possibly self-established by a leaked fail-open
    // event) must NOT count as ownership — that would turn one leak into a
    // permanent exemption.
    aggregator.ingestAgentEvent(v3Event({ event: "SessionStart" }), {
      evidenceSource: "hook",
      stopAuthority: "authoritative",
      turnStartAuthority: "none",
    });
    expect(aggregator.panelCommandOwnedAgent("p1", "1")).toBeNull();

    aggregator.ingestCommandStarted("p1", "1", "cursor-agent", "cursor");
    expect(aggregator.panelCommandOwnedAgent("p1", "1")).toBe("cursor");
    aggregator.dispose();
  });
});

describe("hook pipeline assembly (gate before all effect branches)", () => {
  function sinksWithSpies(overrides: Partial<AgentHookEventSinks> = {}): {
    sinks: AgentHookEventSinks;
    spies: {
      applySessionTitle: ReturnType<typeof vi.fn>;
      ingestAgentEvent: ReturnType<typeof vi.fn>;
      markPanelExited: ReturnType<typeof vi.fn>;
      notifyListeners: ReturnType<typeof vi.fn>;
      observeTranscript: ReturnType<typeof vi.fn>;
      recordResume: ReturnType<typeof vi.fn>;
    };
  } {
    const spies = {
      applySessionTitle: vi.fn(async () => undefined),
      ingestAgentEvent: vi.fn(() => true),
      markPanelExited: vi.fn(),
      notifyListeners: vi.fn(),
      observeTranscript: vi.fn(async () => undefined),
      recordResume: vi.fn(),
    };
    const sinks: AgentHookEventSinks = {
      aggregator: {
        ingestAgentEvent: spies.ingestAgentEvent,
        panelCommandOwnedAgent: () => null,
      },
      applySessionTitle: spies.applySessionTitle,
      markPanelExited: spies.markPanelExited,
      notifyListeners: spies.notifyListeners,
      observeTranscript: spies.observeTranscript,
      recordResume: spies.recordResume,
      resolveRuntime: () => undefined,
      ...overrides,
    };
    return { sinks, spies };
  }

  it("a rejected leak event produces zero side effects on any branch", () => {
    const { sinks, spies } = sinksWithSpies();

    handleObservedAgentHookEvent(
      sinks,
      v3Event({ event: "SessionStart", sessionId: "leak-1", tty: "??" })
    );

    expect(spies.notifyListeners).not.toHaveBeenCalled();
    expect(spies.recordResume).not.toHaveBeenCalled();
    expect(spies.observeTranscript).not.toHaveBeenCalled();
    expect(spies.ingestAgentEvent).not.toHaveBeenCalled();
    expect(spies.markPanelExited).not.toHaveBeenCalled();
    expect(spies.applySessionTitle).not.toHaveBeenCalled();
  });

  it("a ctty-less event passes when the OSC command layer owns the agent", () => {
    const { sinks, spies } = sinksWithSpies({
      aggregator: {
        ingestAgentEvent: vi.fn(() => true),
        panelCommandOwnedAgent: () => "cursor",
      },
    });

    handleObservedAgentHookEvent(
      sinks,
      v3Event({ event: "SessionStart", sessionId: "s1", tty: "??" })
    );

    expect(spies.notifyListeners).toHaveBeenCalledOnce();
  });

  it("an accepted event flows resume persistence before aggregator accept", () => {
    const { sinks, spies } = sinksWithSpies({
      aggregator: {
        // Aggregator may drop the event for its own reasons; resume must
        // still have been persisted (restore key independence).
        ingestAgentEvent: vi.fn(() => false),
        panelCommandOwnedAgent: () => null,
      },
    });

    handleObservedAgentHookEvent(
      sinks,
      v3Event({ event: "SessionStart", sessionId: "s2", tty: "ttys012" })
    );

    expect(spies.recordResume).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "cursor", sessionId: "s2" })
    );
    expect(spies.markPanelExited).not.toHaveBeenCalled();
    expect(spies.applySessionTitle).not.toHaveBeenCalled();
  });

  it("legacy events without tty flow through unchanged", () => {
    const { sinks, spies } = sinksWithSpies();

    handleObservedAgentHookEvent(sinks, v3Event({ event: "PromptSubmit" }));

    expect(spies.notifyListeners).toHaveBeenCalledOnce();
    expect(spies.ingestAgentEvent).toHaveBeenCalledOnce();
  });
});

describe("gen16 tty capture contract", () => {
  it("v3 schema accepts the optional tty field", () => {
    const parsed = agentHookEventSchema.safeParse(v3Event({ tty: "ttys012" }));
    expect(parsed.success).toBe(true);
  });

  it("hook runtime generation is at least 16", () => {
    expect(PIER_HOOK_COMMAND_GENERATION).toBeGreaterThanOrEqual(16);
  });

  it("installed emit script captures the emitter's controlling terminal", async () => {
    const hooksHome = await mkdtemp(join(tmpdir(), "pier-hooks-home-"));
    const userData = await mkdtemp(join(tmpdir(), "pier-user-data-"));
    await installAgentHooksEmitScript(userData, { hooksHome });

    const emit = await readFile(
      join(hooksHome, `v${PIER_HOOK_COMMAND_GENERATION}`, "emit"),
      "utf8"
    );
    expect(emit).toContain("ps -o tty= -p $$");
    expect(emit).toContain('\\"tty\\":');
  });
});
