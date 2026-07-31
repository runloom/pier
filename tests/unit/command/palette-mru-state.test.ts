import { evictWeakest, recordUse } from "@main/state/command-palette-mru.ts";
import {
  EMPTY_MRU_STATE,
  type MruState,
} from "@shared/contracts/command-palette-mru.ts";
import { describe, expect, it } from "vitest";

const day = 86_400_000;

describe("recordUse", () => {
  it("新 actionId → append entry, useCount=1", () => {
    const next = recordUse(EMPTY_MRU_STATE, "pier.x", 1000);
    expect(next.entries).toEqual([
      { actionId: "pier.x", useCount: 1, lastUsedAt: 1000 },
    ]);
  });

  it("已存在 actionId → useCount++ + lastUsedAt 刷新", () => {
    const base: MruState = {
      version: 1,
      entries: [{ actionId: "pier.x", useCount: 3, lastUsedAt: 1000 }],
    };
    const next = recordUse(base, "pier.x", 2000);
    expect(next.entries).toEqual([
      { actionId: "pier.x", useCount: 4, lastUsedAt: 2000 },
    ]);
  });

  it("不破坏旧引用 (immutable)", () => {
    const base: MruState = {
      version: 1,
      entries: [{ actionId: "pier.x", useCount: 1, lastUsedAt: 0 }],
    };
    recordUse(base, "pier.x", 2000);
    expect(base.entries[0]?.useCount).toBe(1);
  });
});

describe("evictWeakest (满 200 时使用)", () => {
  it("frecency 最低的被剔除", () => {
    const now = 100 * day;
    const entries = [
      // useCount=10, age=0 → frecency=10
      { actionId: "hot", useCount: 10, lastUsedAt: now },
      // useCount=1, age=100d → frecency≈0.0073, 最低
      { actionId: "cold", useCount: 1, lastUsedAt: 0 },
      // useCount=2, age=14d → frecency=1
      { actionId: "warm", useCount: 2, lastUsedAt: now - 14 * day },
    ];
    const survivors = evictWeakest(entries, now);
    expect(survivors.map((e) => e.actionId).sort()).toEqual(["hot", "warm"]);
  });
});

describe("recordUse + cap 200", () => {
  it("满 200 时新插入触发逐出 weakest", () => {
    const now = 100 * day;
    const entries = Array.from({ length: 200 }, (_, i) => ({
      actionId: `a${i}`,
      // a0 是最弱的: useCount=1, age=200d
      useCount: i === 0 ? 1 : 5,
      lastUsedAt: i === 0 ? 0 : now - 7 * day,
    }));
    const base: MruState = { version: 1, entries };
    const next = recordUse(base, "fresh", now);
    expect(next.entries).toHaveLength(200);
    expect(next.entries.some((e) => e.actionId === "fresh")).toBe(true);
    expect(next.entries.some((e) => e.actionId === "a0")).toBe(false);
  });
});
