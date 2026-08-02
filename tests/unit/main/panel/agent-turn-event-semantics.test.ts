import {
  type AgentHookEventPayload,
  agentHookEventSchema,
} from "@shared/contracts/agent/session.ts";
import { describe, expect, it } from "vitest";
import { classifyAgentTurnEvent } from "../../../../src/main/services/foreground-activity/agent-turn-event-semantics.ts";
import type { AgentEventIngestOptions } from "../../../../src/main/services/foreground-activity/types.ts";

function event(
  eventName: string,
  overrides: Partial<AgentHookEventPayload> = {}
): AgentHookEventPayload {
  return {
    v: 1,
    kind: "agentEvent",
    agent: "claude",
    event: eventName,
    panelId: "panel-1",
    windowId: "window-1",
    ...overrides,
  };
}

function options(
  overrides: Partial<AgentEventIngestOptions> = {}
): AgentEventIngestOptions {
  return {
    evidenceSource: "hook",
    stopAuthority: "authoritative",
    turnStartAuthority: "none",
    ...overrides,
  };
}

describe("classifyAgentTurnEvent", () => {
  it.each([
    {
      event: event("PromptSubmit"),
      options: options(),
      expected: {
        category: "turn-start",
        createsSession: true,
        mappedStatus: "processing",
        resetEvidence: "explicit-prompt",
      },
    },
    {
      event: event("processing", { turnId: "turn-2" }),
      options: options(),
      expected: {
        category: "turn-start",
        createsSession: true,
        mappedStatus: "processing",
        resetEvidence: "turn-correlatable",
      },
    },
    {
      event: event("running"),
      options: options({ turnStartAuthority: "authoritative" }),
      expected: {
        category: "turn-start",
        createsSession: true,
        mappedStatus: "processing",
        resetEvidence: "provider-authoritative",
      },
    },
    {
      event: event("processing"),
      options: options(),
      expected: {
        category: "progress",
        createsSession: true,
        mappedStatus: "processing",
        resetEvidence: "none",
      },
    },
    {
      event: event("Stop"),
      options: options({ stopAuthority: "advisory" }),
      expected: {
        category: "terminal-candidate",
        createsSession: false,
        mappedStatus: undefined,
        resetEvidence: "none",
      },
    },
    {
      event: event("Stop"),
      options: options({ stopAuthority: "none" }),
      expected: {
        category: "ignored",
        createsSession: false,
        mappedStatus: null,
        resetEvidence: "none",
      },
    },
    {
      event: event("TurnCompleted"),
      options: options(),
      expected: {
        category: "terminal-trusted",
        createsSession: false,
        mappedStatus: "ready",
        resetEvidence: "none",
        terminalStatus: "ready",
      },
    },
    {
      event: event("error"),
      options: options(),
      expected: {
        category: "terminal-trusted",
        createsSession: false,
        mappedStatus: "error",
        resetEvidence: "none",
        terminalStatus: "error",
      },
    },
  ])("$event.event → $expected.category", ({ event, options, expected }) => {
    expect(classifyAgentTurnEvent(event, options)).toEqual(expected);
  });

  it("keeps session lifecycle separate from turn status", () => {
    expect(classifyAgentTurnEvent(event("SessionStart"), options())).toEqual({
      category: "session-start",
      createsSession: true,
      mappedStatus: undefined,
      resetEvidence: "none",
    });
    expect(classifyAgentTurnEvent(event("SessionEnd"), options())).toEqual({
      category: "session-end",
      createsSession: false,
      mappedStatus: undefined,
      resetEvidence: "none",
    });
  });

  it("classifies tool work without inventing a session from completion", () => {
    expect(classifyAgentTurnEvent(event("ToolStart"), options())).toEqual({
      category: "work",
      createsSession: true,
      mappedStatus: "tool",
      resetEvidence: "none",
    });
    expect(classifyAgentTurnEvent(event("ToolComplete"), options())).toEqual({
      category: "work",
      createsSession: false,
      mappedStatus: "processing",
      resetEvidence: "none",
    });
  });

  it("classifies paired interactions as work", () => {
    expect(
      classifyAgentTurnEvent(event("InteractionRequested"), options())
    ).toEqual({
      category: "work",
      createsSession: true,
      mappedStatus: "waiting",
      resetEvidence: "none",
    });
    expect(
      classifyAgentTurnEvent(event("InteractionResolved"), options())
    ).toEqual({
      category: "work",
      createsSession: false,
      mappedStatus: "processing",
      resetEvidence: "none",
    });
  });

  it("classifies subagent work without creating a parent session", () => {
    expect(classifyAgentTurnEvent(event("SubagentStart"), options())).toEqual({
      category: "work",
      createsSession: false,
      mappedStatus: "processing",
      resetEvidence: "none",
    });
    expect(classifyAgentTurnEvent(event("SubagentStop"), options())).toEqual({
      category: "work",
      createsSession: false,
      mappedStatus: "processing",
      resetEvidence: "none",
    });
  });

  it("treats interruption as a trusted ready terminal", () => {
    expect(classifyAgentTurnEvent(event("TurnInterrupted"), options())).toEqual(
      {
        category: "terminal-trusted",
        createsSession: false,
        mappedStatus: "ready",
        resetEvidence: "none",
        terminalStatus: "ready",
      }
    );
  });

  it.each([
    "authoritative",
    "reset-only",
  ] as const)("%s Stop is a trusted ready terminal", (stopAuthority) => {
    expect(
      classifyAgentTurnEvent(event("Stop"), options({ stopAuthority }))
    ).toEqual({
      category: "terminal-trusted",
      createsSession: false,
      mappedStatus: "ready",
      resetEvidence: "none",
      terminalStatus: "ready",
    });
  });

  it.each([
    1, 2,
  ] as const)("keeps v%s PermissionRequest as legacy waiting work", (v) => {
    expect(
      classifyAgentTurnEvent(event("PermissionRequest", { v }), options())
    ).toEqual({
      category: "work",
      createsSession: true,
      mappedStatus: "waiting",
      resetEvidence: "none",
    });
  });

  it("does not accept the legacy single-sided interaction in strict v3", () => {
    expect(
      agentHookEventSchema.safeParse({
        v: 3,
        kind: "agentEvent",
        agent: "claude",
        event: "PermissionRequest",
        nativeEvent: "PermissionRequest",
        panelId: "panel-1",
        windowId: "window-1",
      }).success
    ).toBe(false);
  });

  it("ignores unknown v1 events", () => {
    expect(
      classifyAgentTurnEvent(event("UnknownLegacyEvent"), options())
    ).toEqual({
      category: "ignored",
      createsSession: false,
      mappedStatus: null,
      resetEvidence: "none",
    });
  });
});
