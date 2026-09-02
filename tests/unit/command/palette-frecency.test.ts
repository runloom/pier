import type { MruEntry } from "@shared/contracts/command-palette-mru.ts";
import { describe, expect, it } from "vitest";
import {
  actionRank,
  buildFrecencyMap,
  compareActions,
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
    category: "view",
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

describe("compareActions", () => {
  const mkA = (id: string, sortOrder?: number) => ({
    id,
    category: "view",
    title: () => id,
    handler: () => undefined,
    ...(sortOrder == null ? {} : { metadata: { sortOrder } }),
  });

  it("frecency tier 排在 fallback tier 前面", () => {
    const map = new Map([["a", 1]]);
    expect(compareActions(mkA("a"), mkA("b", 0), map)).toBeLessThan(0);
    expect(compareActions(mkA("b", 0), mkA("a"), map)).toBeGreaterThan(0);
  });

  it("两个 frecency: 高分在前", () => {
    const map = new Map([
      ["a", 5],
      ["b", 10],
    ]);
    expect(compareActions(mkA("b"), mkA("a"), map)).toBeLessThan(0);
  });

  it("两个 fallback: 小 sortOrder 在前", () => {
    expect(compareActions(mkA("a", 1), mkA("b", 5), new Map())).toBeLessThan(0);
  });

  it("equal frecency falls back to sortOrder then id", () => {
    const map = new Map([
      ["a", 5],
      ["b", 5],
    ]);
    expect(compareActions(mkA("a", 2), mkA("b", 1), map)).toBeGreaterThan(0);
    expect(compareActions(mkA("a"), mkA("b"), map)).toBeLessThan(0);
  });
});
