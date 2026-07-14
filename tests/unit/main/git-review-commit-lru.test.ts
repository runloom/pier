import {
  GIT_REVIEW_COMMIT_LRU_MAX_JSON_DEPTH,
  GIT_REVIEW_COMMIT_LRU_MAX_WEIGHT_BYTES,
  GitReviewCommitLru,
} from "@main/services/git-review/git-review-commit-lru.ts";
import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import { describe, expect, it } from "vitest";

describe("GitReviewCommitLru", () => {
  it("默认使用 32 MiB 权重上限", () => {
    const cache = new GitReviewCommitLru<string>();
    expect(cache.maxWeightBytes).toBe(32 * 1024 * 1024);
    expect(cache.maxWeightBytes).toBe(GIT_REVIEW_COMMIT_LRU_MAX_WEIGHT_BYTES);
  });

  it("按累计权重淘汰最久未访问项", () => {
    const cache = new GitReviewCommitLru<string>({ maxWeightBytes: 10 });
    cache.set("a", "A", 4);
    cache.set("b", "B", 4);
    expect(cache.get("a")).toBe("A");

    cache.set("c", "C", 4);

    expect(cache.get("a")).toBe("A");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe("C");
    expect(cache.weightBytes).toBe(8);
  });

  it("同一不可变 key 不覆盖首次值，只提升热度", () => {
    const cache = new GitReviewCommitLru<string>({ maxWeightBytes: 2 });
    expect(cache.set("commit-a", "first", 1)).toBe(true);
    expect(cache.set("commit-a", "replacement", 2)).toBe(false);
    cache.set("commit-b", "second", 1);

    expect(cache.get("commit-a")).toBe("first");
    expect(cache.weightBytes).toBe(2);
  });

  it("已有 key 只 touch，不验证 replacement 或新权重", () => {
    const cache = new GitReviewCommitLru<JsonValue>({ maxWeightBytes: 2 });
    expect(cache.set("commit-a", "first", 1)).toBe(true);

    expect(cache.set("commit-a", { mutable: true }, 0)).toBe(false);
    expect(cache.get("commit-a")).toBe("first");
  });

  it("拒绝超重单项且不逐出已有项", () => {
    const cache = new GitReviewCommitLru<JsonValue>({ maxWeightBytes: 3 });
    cache.set("kept", "value", 3);

    expect(cache.set("oversize", "large", 4)).toBe(false);
    expect(cache.set("mutable-oversize", { mutable: true }, 4)).toBe(false);
    expect(cache.get("kept")).toBe("value");
    expect(cache.size).toBe(1);
  });

  it("拒绝不安全的容量和条目权重", () => {
    expect(() => new GitReviewCommitLru({ maxWeightBytes: 0 })).toThrow(
      RangeError
    );
    const cache = new GitReviewCommitLru<string>();
    expect(() => cache.set("bad", "value", 0)).toThrow(RangeError);
    expect(
      () =>
        new GitReviewCommitLru({
          maxWeightBytes: GIT_REVIEW_COMMIT_LRU_MAX_WEIGHT_BYTES + 1,
        })
    ).toThrow(RangeError);
  });

  it("只接纳深度冻结的普通数据，避免缓存值被外部修改", () => {
    const cache = new GitReviewCommitLru<{ nested: { value: number } }>();
    expect(() => cache.set("mutable", { nested: { value: 1 } }, 1)).toThrow(
      TypeError
    );
    expect(() =>
      cache.set("shallow", Object.freeze({ nested: { value: 1 } }), 1)
    ).toThrow(TypeError);
    const value = Object.freeze({ nested: Object.freeze({ value: 1 }) });

    expect(cache.set("immutable", value, 1)).toBe(true);
    expect(cache.get("immutable")).toBe(value);
  });

  it("拒绝 accessor、symbol key 与 cycle，并接纳冻结的共享 DAG", () => {
    const cache = new GitReviewCommitLru<JsonValue>({ maxWeightBytes: 10 });
    const mutable = { value: 1 };
    const accessor = Object.freeze(
      Object.defineProperty({}, "nested", {
        get: () => mutable,
      })
    );
    const symbol = Symbol("mutable");
    const symbolKeyed = Object.freeze({ [symbol]: mutable });

    expect(() =>
      cache.set("accessor", accessor as unknown as JsonValue, 1)
    ).toThrow(TypeError);
    expect(() =>
      cache.set("symbol", symbolKeyed as unknown as JsonValue, 1)
    ).toThrow(TypeError);

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    Object.freeze(cyclic);
    const nullPrototype = Object.assign(Object.create(null) as object, {
      value: 1,
    });
    Object.freeze(nullPrototype);
    const array = Object.freeze([Object.freeze({ value: 1 })]);

    expect(() => cache.set("cycle", cyclic as unknown as JsonValue, 1)).toThrow(
      TypeError
    );
    expect(cache.set("null-prototype", nullPrototype as JsonValue, 1)).toBe(
      true
    );
    expect(cache.set("array", array as unknown as JsonValue, 1)).toBe(true);

    const shared = Object.freeze({ value: 1 });
    const dag = Object.freeze({ left: shared, right: shared });
    expect(cache.set("shared-dag", dag, 1)).toBe(true);
  });

  it.each([
    ["undefined", Object.freeze({ value: undefined })],
    ["bigint", Object.freeze({ value: 1n })],
    ["symbol-value", Object.freeze({ value: Symbol("value") })],
    ["NaN", Object.freeze({ value: Number.NaN })],
    ["Infinity", Object.freeze({ value: Number.POSITIVE_INFINITY })],
  ])("拒绝非 JSON 值 %s", (_label, value) => {
    const cache = new GitReviewCommitLru<JsonValue>();
    expect(() =>
      cache.set("invalid", value as unknown as JsonValue, 1)
    ).toThrow(TypeError);
  });

  it("拒绝稀疏数组、数组附加属性和超深 JSON", () => {
    const cache = new GitReviewCommitLru<JsonValue>();
    const sparse = new Array(1);
    Object.freeze(sparse);
    const withExtra = [1];
    Object.defineProperty(withExtra, "extra", {
      enumerable: true,
      value: 2,
    });
    Object.freeze(withExtra);
    const withCanonicalNumericExtra = [1];
    Object.defineProperty(withCanonicalNumericExtra, "4294967295", {
      enumerable: true,
      value: undefined,
    });
    Object.freeze(withCanonicalNumericExtra);
    let deep: JsonValue = null;
    for (
      let depth = 0;
      depth <= GIT_REVIEW_COMMIT_LRU_MAX_JSON_DEPTH;
      depth += 1
    ) {
      deep = Object.freeze({ next: deep });
    }

    expect(() => cache.set("sparse", sparse as JsonValue, 1)).toThrow(
      TypeError
    );
    expect(() => cache.set("extra", withExtra as JsonValue, 1)).toThrow(
      TypeError
    );
    expect(() =>
      cache.set(
        "canonical-numeric-extra",
        withCanonicalNumericExtra as unknown as JsonValue,
        1
      )
    ).toThrow(TypeError);
    expect(() => cache.set("deep", deep, 1)).toThrow(TypeError);
  });
});
