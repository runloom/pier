import { beforeEach, describe, expect, it } from "vitest";
import {
  describeCursorSemantics,
  forgetCursorSemantics,
  hasObservedVisibleCursor as hasObservedVisibleCursorForSession,
  recordCursorVisibility as recordCursorVisibilityForSession,
  resetTuiCursorSemanticsForTests,
} from "@/panel-kits/terminal/tui-cursor-semantics.ts";

function recordCursorVisibility(
  input: Omit<
    Parameters<typeof recordCursorVisibilityForSession>[0],
    "activitySpawnedAt"
  > & { activitySpawnedAt?: number }
): boolean {
  const { activitySpawnedAt = 1, ...rest } = input;
  return recordCursorVisibilityForSession({ activitySpawnedAt, ...rest });
}

function hasObservedVisibleCursor(
  input: Omit<
    Parameters<typeof hasObservedVisibleCursorForSession>[0],
    "activitySpawnedAt"
  > & { activitySpawnedAt?: number }
): boolean {
  const { activitySpawnedAt = 1, ...rest } = input;
  return hasObservedVisibleCursorForSession({ activitySpawnedAt, ...rest });
}

beforeEach(() => {
  resetTuiCursorSemanticsForTests();
});

describe("光标语义的会话内观察", () => {
  it("从未见过 visible：不 arm（不得提示风险）", () => {
    expect(
      recordCursorVisibility({
        agentId: "crush",
        panelId: "t-1",
        visibility: "hidden",
      })
    ).toBe(false);
    expect(
      recordCursorVisibility({
        agentId: "crush",
        panelId: "t-1",
        visibility: "unknown",
      })
    ).toBe(false);
    expect(hasObservedVisibleCursor({ agentId: "crush", panelId: "t-1" })).toBe(
      false
    );
  });

  it("见过一次 visible：此后 hidden 才可提示风险", () => {
    recordCursorVisibility({
      agentId: "crush",
      panelId: "t-1",
      visibility: "visible",
    });
    expect(
      recordCursorVisibility({
        agentId: "crush",
        panelId: "t-1",
        visibility: "hidden",
      })
    ).toBe(true);
    expect(hasObservedVisibleCursor({ agentId: "crush", panelId: "t-1" })).toBe(
      true
    );
  });

  it("面板换 agent：旧观察作废，需重新观察 visible", () => {
    recordCursorVisibility({
      agentId: "crush",
      panelId: "t-1",
      visibility: "visible",
    });
    expect(
      recordCursorVisibility({
        agentId: "grok",
        panelId: "t-1",
        visibility: "hidden",
      })
    ).toBe(false);
    expect(hasObservedVisibleCursor({ agentId: "grok", panelId: "t-1" })).toBe(
      false
    );
  });

  it("同面板重启同一种 agent：新活动会话不会继承旧结论", () => {
    recordCursorVisibility({
      activitySpawnedAt: 1,
      agentId: "crush",
      panelId: "t-1",
      visibility: "visible",
    });
    expect(
      recordCursorVisibility({
        activitySpawnedAt: 2,
        agentId: "crush",
        panelId: "t-1",
        visibility: "hidden",
      })
    ).toBe(false);
    expect(
      hasObservedVisibleCursor({
        activitySpawnedAt: 2,
        agentId: "crush",
        panelId: "t-1",
      })
    ).toBe(false);
  });

  it("会话观察按面板隔离", () => {
    recordCursorVisibility({
      agentId: "crush",
      panelId: "t-1",
      visibility: "visible",
    });
    expect(hasObservedVisibleCursor({ agentId: "crush", panelId: "t-2" })).toBe(
      false
    );
  });

  it("诊断快照保留最近读数与 arm 结论", () => {
    recordCursorVisibility({
      agentId: "grok",
      panelId: "t-1",
      visibility: "visible",
    });
    recordCursorVisibility({
      agentId: "grok",
      panelId: "t-1",
      visibility: "hidden",
    });
    expect(describeCursorSemantics("t-1")).toEqual({
      activitySpawnedAt: 1,
      agentId: "grok",
      armed: true,
      last: "hidden",
    });
  });

  it("丢弃面板状态后回到未观察状态", () => {
    recordCursorVisibility({
      agentId: "crush",
      panelId: "t-1",
      visibility: "visible",
    });
    forgetCursorSemantics("t-1");
    expect(describeCursorSemantics("t-1")).toBeUndefined();
    expect(hasObservedVisibleCursor({ agentId: "crush", panelId: "t-1" })).toBe(
      false
    );
  });

  it("面板数超上限：淘汰最早条目，不无界增长", () => {
    for (let index = 0; index < 70; index += 1) {
      recordCursorVisibility({
        agentId: "crush",
        panelId: `t-${index}`,
        visibility: "visible",
      });
    }
    expect(describeCursorSemantics("t-0")).toBeUndefined();
    expect(describeCursorSemantics("t-69")?.armed).toBe(true);
  });

  it("淘汰是 LRU：持续探针的活跃面板不被后开面板挤掉", () => {
    recordCursorVisibility({
      agentId: "crush",
      panelId: "t-active",
      visibility: "visible",
    });
    // 每开一个新面板前都再探一次活跃面板（真实轮询形状）。
    for (let index = 0; index < 70; index += 1) {
      recordCursorVisibility({
        agentId: "crush",
        panelId: "t-active",
        visibility: "hidden",
      });
      recordCursorVisibility({
        agentId: "crush",
        panelId: `t-${index}`,
        visibility: "visible",
      });
    }
    expect(
      hasObservedVisibleCursor({ agentId: "crush", panelId: "t-active" })
    ).toBe(true);
  });
});
