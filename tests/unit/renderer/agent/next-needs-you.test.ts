import type { AgentRuntimeIndexEntry } from "@shared/contracts/agent/runtime-index.ts";
import { makeAgentRef } from "@shared/contracts/agent/runtime-index.ts";
import { describe, expect, it } from "vitest";
import { nextNeedsYouEntry } from "@/lib/agent-runtime/next-needs-you.ts";

function entry(
  overrides: Partial<AgentRuntimeIndexEntry> &
    Pick<AgentRuntimeIndexEntry, "panelId" | "windowId">
): AgentRuntimeIndexEntry {
  return {
    agentId: "claude",
    agentRef: makeAgentRef(overrides.windowId, overrides.panelId),
    source: "hook",
    updatedAt: 10,
    ...overrides,
  };
}

describe("nextNeedsYouEntry", () => {
  it("returns null when nothing needs attention", () => {
    expect(nextNeedsYouEntry([], "a")).toBeNull();
    expect(
      nextNeedsYouEntry(
        [
          entry({
            panelId: "ready",
            status: "ready",
            windowId: "1",
          }),
        ],
        "ready"
      )
    ).toBeNull();
  });

  it("returns the only waiting entry even when it is already focused", () => {
    const waiting = entry({
      panelId: "w",
      status: "waiting",
      windowId: "1",
    });
    expect(nextNeedsYouEntry([waiting], "w")).toEqual(waiting);
    expect(nextNeedsYouEntry([waiting], null)).toEqual(waiting);
  });

  it("returns the next waiting entry after the focused panel", () => {
    const first = entry({
      panelId: "a",
      status: "waiting",
      updatedAt: 20,
      windowId: "1",
    });
    const second = entry({
      panelId: "b",
      status: "waiting",
      updatedAt: 10,
      windowId: "1",
    });
    expect(nextNeedsYouEntry([first, second], "a")?.panelId).toBe("b");
  });

  it("wraps from the last waiting entry to the first", () => {
    const first = entry({
      panelId: "a",
      status: "waiting",
      updatedAt: 20,
      windowId: "1",
    });
    const second = entry({
      panelId: "b",
      status: "error",
      updatedAt: 10,
      windowId: "1",
    });
    expect(nextNeedsYouEntry([first, second], "b")?.panelId).toBe("a");
  });
});
