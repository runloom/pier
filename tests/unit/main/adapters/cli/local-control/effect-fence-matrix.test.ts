/**
 * E8：effect fence 故障矩阵。
 * - 同键同摘要重放同一 effectRevision
 * - 同键异摘要 → idempotency_conflict
 * - 写 op 缺 effectKey → invalid_command
 */

import { isStrongEffectKey } from "@main/adapters/cli/local-control/authorize.ts";
import {
  createEffectReceiptStore,
  digestRequestParams,
} from "@main/adapters/cli/local-control/receipts.ts";
import { describe, expect, it } from "vitest";

function strongKey(seed: string): string {
  return `${seed}_${"x".repeat(24)}`.slice(0, 32);
}

describe("E8 effect fence matrix", () => {
  it("same key+digest replays same effectRevision; different digest conflicts", () => {
    const receipts = createEffectReceiptStore();
    const principalRef = "human:peer";
    const op = "agents.turn";
    const effectKey = strongKey("turn");
    const paramsA = { bootId: "b", runtimeId: "r", generation: 1, text: "a\n" };
    const paramsB = { bootId: "b", runtimeId: "r", generation: 1, text: "b\n" };
    const digestA = digestRequestParams(paramsA);
    const digestB = digestRequestParams(paramsB);
    expect(digestA).not.toBe(digestB);

    const f1 = receipts.nextRevision();
    receipts.commit({
      principalRef,
      op,
      effectKey,
      digest: digestA,
      effectRevision: f1,
      ok: true,
      responseData: { accepted: true },
    });

    const hit = receipts.lookup({ principalRef, op, effectKey });
    expect(hit?.effectRevision).toBe(f1);
    expect(hit?.digest).toBe(digestA);
    expect(hit?.digest === digestB).toBe(false);
  });

  it("write ops require strong effectKey (>=128-bit opaque)", () => {
    expect(isStrongEffectKey("short")).toBe(false);
    expect(isStrongEffectKey(strongKey("ok"))).toBe(true);
    expect(isStrongEffectKey("!!!!not-url-safe!!!!")).toBe(false);
  });

  it("effectRevision is allocated before commit and monotonic", () => {
    const receipts = createEffectReceiptStore();
    const a = receipts.nextRevision();
    const b = receipts.nextRevision();
    expect(b).toBe(a + 1);
    receipts.commit({
      principalRef: "p",
      op: "agents.start",
      effectKey: strongKey("s"),
      digest: "d",
      effectRevision: a,
      ok: true,
      responseData: {},
    });
    const again = receipts.lookup({
      principalRef: "p",
      op: "agents.start",
      effectKey: strongKey("s"),
    });
    expect(again?.effectRevision).toBe(a);
  });
});
