import type { MruEntry } from "@shared/contracts/command-palette-mru.ts";
import { describe, expect, it } from "vitest";
import {
  actionRank,
  buildFrecencyMap,
  groupRank,
} from "@/lib/command-palette/frecency.ts";

const day = 86_400_000;

describe("buildFrecencyMap", () => {
  it("0 天: frecency = useCount", () => {
    const now = 1000 * day;
    const entries: MruEntry[] = [
      { actionId: "x", useCount: 4, lastUsedAt: now },
    ];
    const map = buildFrecencyMap(entries, now);
    expect(map.get("x")).toBeCloseTo(4);
  });

  it("14 天 (一个半衰期): frecency = useCount/2", () => {
    const now = 1000 * day;
    const entries: MruEntry[] = [
      { actionId: "x", useCount: 4, lastUsedAt: now - 14 * day },
    ];
    expect(buildFrecencyMap(entries, now).get("x")).toBeCloseTo(2);
  });

  it("28 天 (两个半衰期): frecency = useCount/4", () => {
    const now = 1000 * day;
    const entries: MruEntry[] = [
      { actionId: "x", useCount: 4, lastUsedAt: now - 28 * day },
    ];
    expect(buildFrecencyMap(entries, now).get("x")).toBeCloseTo(1);
  });
});

describe("actionRank", () => {
  const baseAction = (id: string, sortOrder?: number) => ({
    id,
    category: "View",
    title: () => id,
    handler: () => undefined,
    ...(sortOrder == null ? {} : { metadata: { sortOrder } }),
  });

  it("有 frecency → tier=frecency", () => {
    const map = new Map([["a", 5]]);
    const r = actionRank(baseAction("a"), map);
    expect(r.tier).toBe("frecency");
    if (r.tier === "frecency") {
      expect(r.score).toBe(5);
    }
  });

  it("无 frecency → tier=fallback + sortOrder", () => {
    const map = new Map<string, number>();
    const r = actionRank(baseAction("a", 7), map);
    expect(r.tier).toBe("fallback");
    if (r.tier === "fallback") {
      expect(r.sortOrder).toBe(7);
    }
  });

  it("无 frecency 且无 sortOrder → fallback + 0", () => {
    const r = actionRank(baseAction("a"), new Map());
    if (r.tier === "fallback") {
      expect(r.sortOrder).toBe(0);
    }
  });
});

describe("groupRank", () => {
  const baseAction = (id: string, category: string) => ({
    id,
    category,
    title: () => id,
    handler: () => undefined,
  });

  it("组内任一 action 有 frecency → tier=frecency + maxScore", () => {
    const actions = [baseAction("a", "View"), baseAction("b", "View")];
    const map = new Map([
      ["a", 3],
      ["b", 7],
    ]);
    const r = groupRank(actions, map);
    expect(r.tier).toBe("frecency");
    if (r.tier === "frecency") {
      expect(r.maxScore).toBe(7);
    }
  });

  it("组内全无 frecency → tier=fallback + CATEGORY_META.order", () => {
    const actions = [baseAction("a", "Settings")];
    const r = groupRank(actions, new Map());
    expect(r.tier).toBe("fallback");
    // Settings.order = 4 (见 command-palette.tsx CATEGORY_META)
    if (r.tier === "fallback") {
      expect(r.order).toBe(4);
    }
  });
});
