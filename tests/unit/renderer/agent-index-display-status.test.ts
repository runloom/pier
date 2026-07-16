import type { AgentRuntimeIndexEntry } from "@shared/contracts/agent-runtime-index.ts";
import { makeAgentRef } from "@shared/contracts/agent-runtime-index.ts";
import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import { describe, expect, it } from "vitest";
import {
  enrichAgentIndexEntriesWithLocalFa,
  resolveAgentIndexDisplayStatus,
} from "@/lib/agent-runtime/agent-index-display-status.ts";

function entry(
  overrides: Partial<AgentRuntimeIndexEntry> &
    Pick<AgentRuntimeIndexEntry, "panelId" | "windowId">
): AgentRuntimeIndexEntry {
  return {
    agentId: "omp",
    agentRef: makeAgentRef(overrides.windowId, overrides.panelId),
    source: "hook",
    status: "processing",
    updatedAt: 1,
    ...overrides,
  };
}

function activity(
  overrides: Partial<AgentActivity> & Pick<AgentActivity, "panelId" | "status">
): AgentActivity {
  return {
    agentId: "omp",
    kind: "agent",
    source: "hook",
    spawnedAt: 1,
    subagentCount: 0,
    updatedAt: 2,
    windowId: "1",
    ...overrides,
  };
}

describe("resolveAgentIndexDisplayStatus", () => {
  it("overlays live FA status when windowId matches", () => {
    const resolved = resolveAgentIndexDisplayStatus(
      entry({
        panelId: "p1",
        stateStartedAt: 10,
        status: "processing",
        windowId: "1",
      }),
      activity({
        panelId: "p1",
        stateStartedAt: 20,
        status: "tool",
        subagentCount: 2,
      })
    );
    expect(resolved).toMatchObject({
      spawnedAt: 1,
      stateStartedAt: 20,
      status: "tool",
      subagentCount: 2,
    });
  });

  it("keeps Index status when FA windowId differs", () => {
    const resolved = resolveAgentIndexDisplayStatus(
      entry({
        panelId: "p1",
        status: "processing",
        windowId: "2",
      }),
      activity({ panelId: "p1", status: "tool", windowId: "1" })
    );
    expect(resolved).toEqual({ status: "processing", subagentCount: 0 });
  });
});

describe("enrichAgentIndexEntriesWithLocalFa", () => {
  it("moves local waiting into Needs you fields for partition", () => {
    const [enriched] = enrichAgentIndexEntriesWithLocalFa(
      [
        entry({
          panelId: "p1",
          status: "processing",
          windowId: "1",
        }),
      ],
      {
        p1: activity({ panelId: "p1", status: "waiting", windowId: "1" }),
      }
    );
    expect(enriched?.status).toBe("waiting");
  });

  it("does not enrich other-window entries", () => {
    const [enriched] = enrichAgentIndexEntriesWithLocalFa(
      [entry({ panelId: "p1", status: "processing", windowId: "2" })],
      {
        p1: activity({ panelId: "p1", status: "waiting", windowId: "1" }),
      }
    );
    expect(enriched?.status).toBe("processing");
  });
});
