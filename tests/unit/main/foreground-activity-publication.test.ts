import { describe, expect, it } from "vitest";
import { materializeForegroundActivityPublications } from "../../../src/main/ipc/foreground-activity-publication.ts";

describe("foreground activity publication", () => {
  it("向每个存活窗口发布同一 ts 的完整窗口快照，包括空数组", () => {
    const publications = materializeForegroundActivityPublications(
      {
        activities: [
          {
            agentId: "codex",
            kind: "agent",
            panelId: "panel-1",
            source: "hook",
            spawnedAt: 1,
            status: "processing",
            subagentCount: 0,
            updatedAt: 2,
            windowId: "7",
          },
        ],
        ts: 42,
      },
      [7, 8]
    );

    expect(publications).toEqual([
      {
        payload: {
          activities: [expect.objectContaining({ panelId: "panel-1" })],
          ts: 42,
        },
        windowId: "7",
      },
      { payload: { activities: [], ts: 42 }, windowId: "8" },
    ]);
  });

  it("全局活动清空时仍给全部存活窗口发布清空快照", () => {
    expect(
      materializeForegroundActivityPublications(
        { activities: [], ts: 43 },
        [7, 8]
      )
    ).toEqual([
      { payload: { activities: [], ts: 43 }, windowId: "7" },
      { payload: { activities: [], ts: 43 }, windowId: "8" },
    ]);
  });
});
