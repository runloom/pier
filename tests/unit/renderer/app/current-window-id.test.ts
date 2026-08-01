import { afterEach, describe, expect, it } from "vitest";
import {
  currentElectronWindowId,
  rememberElectronWindowId,
  resetElectronWindowIdForTests,
} from "@/lib/agent-runtime/current-window-id.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";

describe("currentElectronWindowId", () => {
  afterEach(() => {
    resetElectronWindowIdForTests();
    useForegroundActivityStore.setState({ activities: {}, ts: 0 });
  });

  it("returns remembered id without needing FA activities", () => {
    rememberElectronWindowId("42");
    expect(currentElectronWindowId()).toBe("42");
  });

  it("falls back to FA activity windowId and caches it", () => {
    useForegroundActivityStore.setState({
      activities: {
        p1: {
          agentId: "claude",
          kind: "agent",
          panelId: "p1",
          source: "hook",
          spawnedAt: 1,
          status: "tool",
          subagentCount: 0,
          updatedAt: 1,
          windowId: "7",
        },
      },
      ts: 1,
    });
    expect(currentElectronWindowId()).toBe("7");
    useForegroundActivityStore.setState({ activities: {}, ts: 2 });
    expect(currentElectronWindowId()).toBe("7");
  });
});
