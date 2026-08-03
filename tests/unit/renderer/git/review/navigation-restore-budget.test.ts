import { describe, expect, it } from "vitest";
import {
  EMPTY_RESTORE_NAVIGATION_BUDGET,
  RESTORE_NAVIGATION_MAX_ATTEMPTS,
  type RestoreNavigationBudget,
  spendRestoreNavigationAttempt,
} from "../../../../../src/plugins/builtin/git/renderer/hooks/use-navigation-restore.ts";

/** 反复恢复同一目标，返回实际成交的次数。 */
function drain(entryKey: string, generation: number, rounds: number): number {
  let budget: RestoreNavigationBudget = EMPTY_RESTORE_NAVIGATION_BUDGET;
  let armed = 0;
  for (let round = 0; round < rounds; round += 1) {
    const next = spendRestoreNavigationAttempt(budget, entryKey, generation);
    if (next === null) {
      continue;
    }
    budget = next;
    armed += 1;
  }
  return armed;
}

describe("被动恢复尝试预算", () => {
  it("同一目标同一代次内必须收敛到上限，而不是无限重试", () => {
    // 恢复由渲染窗口上报触发，而恢复自身又会改变布局并产生新的上报。
    // 没有上限时这个环不会停：滚动条持续抖动、条目反复重渲染。
    expect(drain("entry:a", 1, 100)).toBe(RESTORE_NAVIGATION_MAX_ATTEMPTS);
  });

  it("换文档代次重新获得完整预算", () => {
    const spent = spendRestoreNavigationAttempt(
      { count: RESTORE_NAVIGATION_MAX_ATTEMPTS, key: "entry:a\u00001" },
      "entry:a",
      2
    );
    expect(spent).toEqual({ count: 1, key: "entry:a\u00002" });
  });

  it("换目标重新获得完整预算", () => {
    const spent = spendRestoreNavigationAttempt(
      { count: RESTORE_NAVIGATION_MAX_ATTEMPTS, key: "entry:a\u00001" },
      "entry:b",
      1
    );
    expect(spent).toEqual({ count: 1, key: "entry:b\u00001" });
  });

  it("耗尽后返回 null，调用方据此静默放弃", () => {
    expect(
      spendRestoreNavigationAttempt(
        { count: RESTORE_NAVIGATION_MAX_ATTEMPTS, key: "entry:a\u00001" },
        "entry:a",
        1
      )
    ).toBeNull();
  });
});
