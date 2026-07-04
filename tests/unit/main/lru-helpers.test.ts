import { pruneArray, pruneToLimit } from "@main/state/lru-helpers.ts";
import { describe, expect, it } from "vitest";

// ── pruneToLimit ────────────────────────────────────────────────

describe("pruneToLimit", () => {
  it("size <= limit → 不淘汰", () => {
    const map = new Map([
      ["a", { ts: 1 }],
      ["b", { ts: 2 }],
    ]);
    const evicted = pruneToLimit(map, 5, (v) => v.ts);
    expect(evicted).toEqual([]);
    expect(map.size).toBe(2);
  });

  it("size > limit → 逐出最旧直到 size == limit", () => {
    const map = new Map([
      ["a", { ts: 10 }],
      ["b", { ts: 1 }],
      ["c", { ts: 5 }],
      ["d", { ts: 3 }],
    ]);
    const evicted = pruneToLimit(map, 2, (v) => v.ts);
    // b(1) 和 d(3) 最旧，先逐 b 再逐 d
    expect(evicted).toEqual(["b", "d"]);
    expect(map.size).toBe(2);
    expect(map.has("a")).toBe(true);
    expect(map.has("c")).toBe(true);
  });

  it("limit 为 0 → 全部逐出", () => {
    const map = new Map([
      ["x", { ts: 100 }],
      ["y", { ts: 200 }],
    ]);
    const evicted = pruneToLimit(map, 0, (v) => v.ts);
    expect(evicted).toHaveLength(2);
    expect(map.size).toBe(0);
  });

  it("空 Map → 返回空数组", () => {
    const map = new Map<string, { ts: number }>();
    const evicted = pruneToLimit(map, 0, (v) => v.ts);
    expect(evicted).toEqual([]);
  });

  it("相同 keyOf 值 → 按迭代序逐出第一个命中的", () => {
    const map = new Map([
      ["a", { ts: 5 }],
      ["b", { ts: 5 }],
      ["c", { ts: 5 }],
    ]);
    const evicted = pruneToLimit(map, 1, (v) => v.ts);
    expect(evicted).toHaveLength(2);
    expect(map.size).toBe(1);
  });

  it("非 string key 亦可", () => {
    const map = new Map<number, { updatedAt: number }>([
      [1, { updatedAt: 300 }],
      [2, { updatedAt: 100 }],
      [3, { updatedAt: 200 }],
    ]);
    const evicted = pruneToLimit(map, 1, (v) => v.updatedAt);
    expect(evicted).toEqual([2, 3]);
    expect(map.has(1)).toBe(true);
  });
});

// ── pruneArray ──────────────────────────────────────────────────

describe("pruneArray", () => {
  it("arr.length <= limit → 返回完整浅拷贝", () => {
    const arr = [1, 2, 3];
    const result = pruneArray(arr, 5);
    expect(result).toEqual([1, 2, 3]);
    // 应是新数组
    expect(result).not.toBe(arr);
  });

  it("arr.length > limit → 只保留前 limit 个", () => {
    expect(pruneArray([10, 20, 30, 40, 50], 3)).toEqual([10, 20, 30]);
  });

  it("limit 为 0 → 返回空数组", () => {
    expect(pruneArray([1, 2], 0)).toEqual([]);
  });

  it("负数 limit → 返回空数组", () => {
    expect(pruneArray([1, 2], -1)).toEqual([]);
  });

  it("空数组 → 返回空数组", () => {
    expect(pruneArray([], 10)).toEqual([]);
  });

  it("readonly 输入 → 正常工作", () => {
    const arr: readonly string[] = ["a", "b", "c"];
    const result = pruneArray(arr, 2);
    expect(result).toEqual(["a", "b"]);
  });
});
