import { createForegroundActivityAggregator } from "@main/services/foreground-activity/aggregator.ts";
import type { PanelTabChrome } from "@shared/contracts/panel.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activityTabChromeOverlay,
  mergeTabChrome,
} from "@/panel-kits/terminal/terminal-tab-chrome.ts";

/**
 * 回归：task 退出后 tab chrome 不得回退到陈旧 "Running" 基线。
 *
 * 老 TERMINAL_TAB_CHROME_PATCHED 推送通路已下线, renderer 的 task 退出
 * chrome 单源是 foreground-activity 广播（terminal-panel.tsx: base →
 * restore-patch → activity overlay）。修复前聚合器在 taskFinished 后 5s
 * linger 即丢弃 task 层, overlay 变 null, mergeTabChrome 原样返回 base,
 * tab 卡死在 "Running" 转圈。本测试跨 main/renderer 缝合面复现：退出 60s
 * 后取 snapshot, 走与生产完全一致的 overlay+merge 管线断言终态。
 */
describe("task exit tab chrome across aggregator → overlay seam", () => {
  let clock = 0;
  const now = (): number => clock;

  beforeEach(() => {
    clock = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function advance(ms: number): void {
    clock += ms;
    vi.advanceTimersByTime(ms);
  }

  /** task panel 启动时的真实基线 chrome（task-execution-plan.ts）。 */
  function runningBase(): PanelTabChrome {
    return {
      state: { label: "Running", status: "running" },
      title: "npm build",
    };
  }

  it("success 退出 60s 后 merged chrome 为 succeeded, 非陈旧 running", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("p1", "1", { taskId: "t1", label: "npm build" });
    agg.taskFinished("p1", { status: "success", exitCode: 0 });
    // 远超旧 5s linger——修复前活动在此已被丢弃
    advance(60_000);

    // 与 terminal-panel.tsx 相同的数据流：活动缺席时 overlay 为 null,
    // merge 回退 base——断言将以 "running" 失败, 即本 bug 的确切症状。
    const activity = agg.snapshot().activities.find((a) => a.panelId === "p1");
    const merged = mergeTabChrome(
      runningBase(),
      activityTabChromeOverlay(activity)
    );

    expect(merged?.state?.status).toBe("succeeded");
    expect(merged?.title).toBe("npm build");

    // 佐证：活动本体确实以终态常驻（而非碰巧由别的层供给 chrome）
    expect(activity?.kind).toBe("task");
    if (activity?.kind === "task") {
      expect(activity.status).toBe("success");
    }
    agg.dispose();
  });

  it("failure 退出 60s 后 merged chrome 为 failed", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("p1", "1", { taskId: "t1", label: "npm build" });
    agg.taskFinished("p1", { status: "failure", exitCode: 1 });
    advance(60_000);

    const activity = agg.snapshot().activities.find((a) => a.panelId === "p1");
    const merged = mergeTabChrome(
      runningBase(),
      activityTabChromeOverlay(activity)
    );

    expect(merged?.state?.status).toBe("failed");
    expect(merged?.title).toBe("npm build");
    expect(activity?.kind).toBe("task");
    if (activity?.kind === "task") {
      expect(activity.exitCode).toBe(1);
    }
    agg.dispose();
  });
});
