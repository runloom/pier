import type { AgentSessionsBroadcast } from "@shared/contracts/agent-session.ts";
import { beforeEach, describe, expect, it } from "vitest";
import {
  agentSessionCounts,
  useAgentSessionStore,
} from "../../src/renderer/stores/agent-session.store.ts";

function broadcast(
  ts: number,
  sessions: Array<{
    panelId: string;
    status: "processing" | "tool" | "waiting" | "ready" | "error";
  }>
): AgentSessionsBroadcast {
  return {
    sessions: sessions.map((s) => ({
      panelId: s.panelId,
      source: "hook" as const,
      stateStartedAt: 0,
      status: s.status,
      subagentCount: 0,
      updatedAt: ts,
      windowId: "1",
    })),
    ts,
  };
}

describe("useAgentSessionStore", () => {
  beforeEach(() => {
    useAgentSessionStore.setState({ sessions: {}, ts: 0 });
  });

  it("apply 以 panelId 索引会话", () => {
    useAgentSessionStore
      .getState()
      .apply(broadcast(100, [{ panelId: "p1", status: "processing" }]));
    expect(useAgentSessionStore.getState().sessions.p1?.status).toBe(
      "processing"
    );
  });

  it("拒收过期快照(乱序广播防御)", () => {
    const { apply } = useAgentSessionStore.getState();
    apply(broadcast(200, [{ panelId: "p1", status: "waiting" }]));
    apply(broadcast(100, [{ panelId: "p1", status: "processing" }]));
    expect(useAgentSessionStore.getState().sessions.p1?.status).toBe("waiting");
  });
});

describe("agentSessionCounts", () => {
  beforeEach(() => {
    useAgentSessionStore.setState({ sessions: {}, ts: 0 });
  });

  it("processing/tool 计 running, waiting 计 waiting, ready/error 不计", () => {
    useAgentSessionStore.getState().apply(
      broadcast(1, [
        { panelId: "a", status: "processing" },
        { panelId: "b", status: "tool" },
        { panelId: "c", status: "waiting" },
        { panelId: "d", status: "ready" },
        { panelId: "e", status: "error" },
      ])
    );
    expect(
      agentSessionCounts(useAgentSessionStore.getState().sessions)
    ).toEqual({ running: 2, waiting: 1 });
  });
});
