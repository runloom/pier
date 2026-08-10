import {
  canonicalizeJson,
  createEffectReceiptStore,
  digestRequestParams,
} from "@main/adapters/cli/local-control-receipts.ts";
import { describe, expect, it } from "vitest";

describe("canonicalizeJson / digestRequestParams (JCS-like)", () => {
  it("sorts object keys at every nesting level", () => {
    const a = canonicalizeJson({ z: 1, a: { y: 2, b: 3 } });
    const b = canonicalizeJson({ a: { b: 3, y: 2 }, z: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  it("preserves array order while canonicalizing elements", () => {
    expect(canonicalizeJson([{ b: 1, a: 2 }, { z: 0 }])).toBe(
      '[{"a":2,"b":1},{"z":0}]'
    );
  });

  it("omits undefined object values and maps undefined array slots to null", () => {
    expect(canonicalizeJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalizeJson([1, undefined, 2])).toBe("[1,null,2]");
  });

  it("digest is stable under key reordering (nested)", () => {
    const d1 = digestRequestParams({
      outer: { note: "x", nested: { b: 2, a: 1 } },
      flag: true,
    });
    const d2 = digestRequestParams({
      flag: true,
      outer: { nested: { a: 1, b: 2 }, note: "x" },
    });
    expect(d1).toBe(d2);
    expect(d1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("digest differs when nested value differs", () => {
    const d1 = digestRequestParams({ outer: { nested: { a: 1 } } });
    const d2 = digestRequestParams({ outer: { nested: { a: 2 } } });
    expect(d1).not.toBe(d2);
  });

  it("rejects non-JSON values", () => {
    expect(() => canonicalizeJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalizeJson(() => 0)).toThrow(/unsupported/);
  });
});

describe("createEffectReceiptStore", () => {
  it("looks up by principal+op+effectKey and advances revision", () => {
    const store = createEffectReceiptStore();
    const r1 = store.nextRevision();
    const r2 = store.nextRevision();
    expect(r2).toBe(r1 + 1);
    store.commit({
      effectKey: "k".repeat(22),
      op: "control.trace",
      principalRef: "cli-human",
      digest: "abc",
      effectRevision: r1,
      responseData: { ok: true },
    });
    const hit = store.lookup({
      principalRef: "cli-human",
      op: "control.trace",
      effectKey: "k".repeat(22),
    });
    expect(hit?.digest).toBe("abc");
    expect(
      store.lookup({
        principalRef: "other",
        op: "control.trace",
        effectKey: "k".repeat(22),
      })
    ).toBeUndefined();
  });
});
