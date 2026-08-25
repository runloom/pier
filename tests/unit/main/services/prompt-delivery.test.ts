import {
  deliverPromptWithBackoff,
  type PromptDeliveryIo,
} from "@main/services/runtime-control/prompt-delivery.ts";
import { describe, expect, it } from "vitest";

interface IoScript {
  paste: Array<{ ok: boolean; textDelivered?: boolean }>;
  submitReturn?: boolean[];
}

function scriptedIo(script: IoScript): PromptDeliveryIo & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async paste(text) {
      calls.push(`paste:${text}`);
      const next = script.paste.shift();
      if (!next) {
        throw new Error("unexpected extra paste");
      }
      return next;
    },
    async submitReturn() {
      calls.push("submitReturn");
      const next = script.submitReturn?.shift();
      if (next === undefined) {
        throw new Error("unexpected extra submitReturn");
      }
      return next;
    },
  };
}

const noSleep = () => Promise.resolve();
const opts = (delays: readonly number[], now = () => 0) => ({
  delays,
  budgetMs: Number.POSITIVE_INFINITY,
  nowMs: now,
  sleep: noSleep,
});

describe("deliverPromptWithBackoff", () => {
  const TEXT = "prompt";

  it("returns true when first paste lands", async () => {
    const io = scriptedIo({ paste: [{ ok: true }] });
    await expect(deliverPromptWithBackoff(io, TEXT, opts([0]))).resolves.toBe(
      true
    );
    expect(io.calls).toEqual([`paste:${TEXT}`]);
  });

  it("re-pastes the full text while nothing was delivered", async () => {
    const io = scriptedIo({
      paste: [{ ok: false }, { ok: false, textDelivered: false }, { ok: true }],
    });
    await expect(
      deliverPromptWithBackoff(io, TEXT, opts([1, 1]))
    ).resolves.toBe(true);
    expect(io.calls).toEqual([
      `paste:${TEXT}`,
      `paste:${TEXT}`,
      `paste:${TEXT}`,
    ]);
  });

  it("switches to submit-return only after text landed but enter failed", async () => {
    const io = scriptedIo({
      paste: [{ ok: false, textDelivered: true }],
      submitReturn: [true],
    });
    await expect(deliverPromptWithBackoff(io, TEXT, opts([1]))).resolves.toBe(
      true
    );
    expect(io.calls).toEqual([`paste:${TEXT}`, "submitReturn"]);
  });

  it("keeps using submit-return once delivered even if enter keeps failing", async () => {
    const io = scriptedIo({
      paste: [{ ok: false, textDelivered: true }],
      submitReturn: [false, true],
    });
    await expect(
      deliverPromptWithBackoff(io, TEXT, opts([0, 0]))
    ).resolves.toBe(true);
    expect(io.calls).toEqual([`paste:${TEXT}`, "submitReturn", "submitReturn"]);
  });

  it("gives up after exhausting delays", async () => {
    const io = scriptedIo({
      paste: [{ ok: false }, { ok: false }, { ok: false }],
    });
    await expect(
      deliverPromptWithBackoff(io, TEXT, opts([0, 0]))
    ).resolves.toBe(false);
    expect(io.calls).toEqual([
      `paste:${TEXT}`,
      `paste:${TEXT}`,
      `paste:${TEXT}`,
    ]);
  });

  it("stops early when the budget expires", () => {
    const now = (() => {
      let tick = 0;
      return () => {
        tick += 10;
        return tick;
      };
    })();
    const io = scriptedIo({ paste: [{ ok: false }, { ok: false }] });
    const done = deliverPromptWithBackoff(io, TEXT, {
      delays: [0, 0],
      budgetMs: 5,
      nowMs: now,
      sleep: noSleep,
    });
    return expect(done).resolves.toBe(false);
  });
});
