import { describe, expect, it } from "vitest";
import { resolveAgentTurnStartAuthority } from "../../../../src/main/services/agents/integrations/runtime-event-authority.ts";
import type { AgentRuntimeSemantics } from "../../../../src/main/services/agents/integrations/types.ts";

const runtime: AgentRuntimeSemantics = {
  emittedMappings: [
    {
      nativeEvent: "TaskResume",
      pierEvent: "running",
      turnStartAuthority: "authoritative",
    },
  ],
  stopAuthority: "none",
};

describe("agent runtime event authority", () => {
  it("只在原生事件与规范事件同时匹配时授予权威", () => {
    expect(
      resolveAgentTurnStartAuthority(runtime, {
        agent: "cline",
        event: "running",
        kind: "agentEvent",
        nativeEvent: "TaskResume",
        panelId: "p1",
        v: 3,
        windowId: "w1",
      })
    ).toBe("authoritative");

    expect(
      resolveAgentTurnStartAuthority(runtime, {
        agent: "cline",
        event: "processing",
        kind: "agentEvent",
        nativeEvent: "TaskResume",
        panelId: "p1",
        v: 2,
        windowId: "w1",
      })
    ).toBe("none");
  });

  it("v1 事件与未知映射均不获得权威", () => {
    expect(
      resolveAgentTurnStartAuthority(runtime, {
        agent: "cline",
        event: "running",
        kind: "agentEvent",
        panelId: "p1",
        v: 1,
        windowId: "w1",
      })
    ).toBe("none");

    expect(
      resolveAgentTurnStartAuthority(undefined, {
        agent: "cline",
        event: "running",
        kind: "agentEvent",
        nativeEvent: "TaskResume",
        panelId: "p1",
        v: 3,
        windowId: "w1",
      })
    ).toBe("none");
  });
});
