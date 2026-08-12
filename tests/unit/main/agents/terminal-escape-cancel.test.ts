import { agentHookEventSchema } from "@shared/contracts/agent/session.ts";
import type {
  ActivityStatus,
  ForegroundActivity,
} from "@shared/contracts/foreground-activity.ts";
import { describe, expect, it } from "vitest";
import {
  buildTerminalEscapeCancelEvent,
  shouldCancelAgentOnTerminalEscape,
} from "../../../../src/main/services/agents/terminal-escape-cancel.ts";

function agentActivity(status: ActivityStatus | undefined): ForegroundActivity {
  return {
    agentId: "claude",
    kind: "agent",
    panelId: "terminal-1",
    source: "hook",
    spawnedAt: 1,
    status,
    subagentCount: 0,
    updatedAt: 2,
    windowId: "1",
    sessionId: "sess-1",
  };
}

describe("terminal escape cancel", () => {
  it("processing/tool 可取消", () => {
    expect(shouldCancelAgentOnTerminalEscape(agentActivity("processing"))).toBe(
      true
    );
    expect(shouldCancelAgentOnTerminalEscape(agentActivity("tool"))).toBe(true);
  });

  it("ready/waiting/shell 不取消", () => {
    expect(shouldCancelAgentOnTerminalEscape(agentActivity("ready"))).toBe(
      false
    );
    expect(shouldCancelAgentOnTerminalEscape(agentActivity("waiting"))).toBe(
      false
    );
    expect(
      shouldCancelAgentOnTerminalEscape({
        kind: "shell",
        panelId: "terminal-1",
        spawnedAt: 1,
        updatedAt: 2,
        windowId: "1",
      })
    ).toBe(false);
    expect(shouldCancelAgentOnTerminalEscape(undefined)).toBe(false);
  });

  it("构造合法 v3 TurnInterrupted 事件", () => {
    const event = buildTerminalEscapeCancelEvent({
      agentId: "claude",
      panelId: "terminal-1",
      windowId: "1",
      sessionId: "sess-1",
    });
    expect(event).toMatchObject({
      agent: "claude",
      event: "TurnInterrupted",
      kind: "agentEvent",
      nativeEvent: "pier.terminal.user_escape",
      panelId: "terminal-1",
      sessionId: "sess-1",
      v: 3,
      windowId: "1",
    });
    expect(agentHookEventSchema.safeParse(event).success).toBe(true);
  });
});
