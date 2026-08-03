import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AgentHookEventPayload,
  agentHookEventSchema,
} from "@shared/contracts/agent/session.ts";
import { describe, expect, it } from "vitest";
import { classifyAgentTurnEvent } from "../../../../src/main/services/foreground-activity/agent-turn-event-semantics.ts";
import type { AgentEventIngestOptions } from "../../../../src/main/services/foreground-activity/types.ts";

function event(
  eventName: string,
  overrides: Partial<Extract<AgentHookEventPayload, { v: 1 }>> = {}
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
        cancelsTerminalCandidate: true,
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
        cancelsTerminalCandidate: true,
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
        cancelsTerminalCandidate: true,
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
        cancelsTerminalCandidate: true,
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
        cancelsTerminalCandidate: false,
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
        cancelsTerminalCandidate: false,
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
        cancelsTerminalCandidate: false,
        category: "terminal-trusted",
        createsSession: false,
        mappedStatus: "ready",
        resetEvidence: "none",
        terminalEvidence: "ready",
        terminalStatus: "ready",
      },
    },
    {
      event: event("error"),
      options: options(),
      expected: {
        cancelsTerminalCandidate: false,
        category: "terminal-trusted",
        createsSession: false,
        mappedStatus: "error",
        resetEvidence: "none",
        terminalEvidence: "error",
        terminalStatus: "error",
      },
    },
  ])("$event.event → $expected.category", ({ event, options, expected }) => {
    expect(classifyAgentTurnEvent(event, options)).toEqual(expected);
  });

  it("keeps session lifecycle separate from turn status", () => {
    expect(classifyAgentTurnEvent(event("SessionStart"), options())).toEqual({
      cancelsTerminalCandidate: false,
      category: "session-start",
      createsSession: true,
      mappedStatus: undefined,
      resetEvidence: "none",
    });
    expect(classifyAgentTurnEvent(event("SessionEnd"), options())).toEqual({
      cancelsTerminalCandidate: false,
      category: "session-end",
      createsSession: false,
      mappedStatus: undefined,
      resetEvidence: "none",
    });
  });

  it("classifies tool work without inventing a session from completion", () => {
    expect(classifyAgentTurnEvent(event("ToolStart"), options())).toEqual({
      cancelsTerminalCandidate: true,
      category: "work",
      createsSession: true,
      mappedStatus: "tool",
      resetEvidence: "none",
    });
    expect(classifyAgentTurnEvent(event("ToolComplete"), options())).toEqual({
      cancelsTerminalCandidate: false,
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
      cancelsTerminalCandidate: true,
      category: "work",
      createsSession: true,
      mappedStatus: "waiting",
      resetEvidence: "none",
    });
    expect(
      classifyAgentTurnEvent(event("InteractionResolved"), options())
    ).toEqual({
      cancelsTerminalCandidate: false,
      category: "work",
      createsSession: false,
      mappedStatus: "processing",
      resetEvidence: "none",
    });
  });

  it("classifies subagent work without creating a parent session", () => {
    expect(classifyAgentTurnEvent(event("SubagentStart"), options())).toEqual({
      cancelsTerminalCandidate: false,
      category: "work",
      createsSession: false,
      mappedStatus: "processing",
      resetEvidence: "none",
    });
    expect(classifyAgentTurnEvent(event("SubagentStop"), options())).toEqual({
      cancelsTerminalCandidate: false,
      category: "work",
      createsSession: false,
      mappedStatus: "processing",
      resetEvidence: "none",
    });
  });

  it.each([
    { eventName: "PromptSubmit", want: true },
    { eventName: "ToolStart", want: true },
    { eventName: "InteractionRequested", want: true },
    { eventName: "processing", want: true },
    { eventName: "running", want: true },
    { eventName: "ToolComplete", want: false },
    { eventName: "InteractionResolved", want: false },
    { eventName: "SubagentStart", want: false },
    { eventName: "SubagentStop", want: false },
    { eventName: "TurnCompleted", want: false },
    { eventName: "TurnInterrupted", want: false },
    { eventName: "error", want: false },
    { eventName: "Stop", want: false },
  ] as const)("$eventName 的候选取消事实为 $want", ({ eventName, want }) => {
    expect(
      classifyAgentTurnEvent(event(eventName), options())
        .cancelsTerminalCandidate
    ).toBe(want);
  });

  it("treats interruption as a trusted ready terminal", () => {
    expect(classifyAgentTurnEvent(event("TurnInterrupted"), options())).toEqual(
      {
        cancelsTerminalCandidate: false,
        category: "terminal-trusted",
        createsSession: false,
        mappedStatus: "ready",
        resetEvidence: "none",
        terminalEvidence: "interrupted",
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
      cancelsTerminalCandidate: false,
      category: "terminal-trusted",
      createsSession: false,
      mappedStatus: "ready",
      resetEvidence: "none",
      terminalEvidence: "ready",
      terminalStatus: "ready",
    });
  });

  it.each([
    1, 2,
  ] as const)("keeps v%s PermissionRequest as legacy waiting work", (v) => {
    const legacyEvent: AgentHookEventPayload =
      v === 1
        ? event("PermissionRequest")
        : {
            ...event("PermissionRequest"),
            nativeEvent: "PermissionRequest",
            v: 2,
          };
    expect(classifyAgentTurnEvent(legacyEvent, options())).toEqual({
      cancelsTerminalCandidate: false,
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
      cancelsTerminalCandidate: false,
      category: "ignored",
      createsSession: false,
      mappedStatus: null,
      resetEvidence: "none",
    });
  });

  it.each([
    "processing",
    "running",
  ])("%s 同时带 turnId 与适配器权威时仍优先分类为可关联起点", (eventName) => {
    expect(
      classifyAgentTurnEvent(
        event(eventName, { turnId: "turn-correlatable" }),
        options({ turnStartAuthority: "authoritative" })
      )
    ).toMatchObject({
      category: "turn-start",
      resetEvidence: "turn-correlatable",
    });
  });

  it("生命周期事件名只允许分类器解释，下游只消费分类结果", () => {
    const downstreamFiles = [
      "aggregator.ts",
      "aggregator-hook-scopes.ts",
      "entry.ts",
      "turn-bookkeeping.ts",
    ];
    const directLifecycleBranch =
      /(?:event\.event|eventName)\s*[!=]==?\s*["']Session(?:Start|End)["']/;

    for (const file of downstreamFiles) {
      const source = readFileSync(
        join(process.cwd(), "src/main/services/foreground-activity", file),
        "utf8"
      );
      expect(source, file).not.toMatch(directLifecycleBranch);
    }
  });
});
