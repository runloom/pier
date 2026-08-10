import {
  POST_SUCCESS_IDLE_RELEASE_MS,
  POST_SUCCESS_MAX_HOLD_MS,
  REVEAL_RETRY_DELAYS_MS,
} from "@pier/ui/file/tree-reveal-timing.ts";
import { describe, expect, it } from "vitest";

describe("tree-reveal-timing gold standard", () => {
  it("keeps post-success hold short so compensate is not blocked for seconds", () => {
    expect(POST_SUCCESS_MAX_HOLD_MS).toBeLessThanOrEqual(800);
    expect(POST_SUCCESS_IDLE_RELEASE_MS).toBeLessThanOrEqual(
      POST_SUCCESS_MAX_HOLD_MS
    );
  });

  it("retries cold opens with a bounded delay ladder", () => {
    expect(REVEAL_RETRY_DELAYS_MS[0]).toBe(0);
    expect(REVEAL_RETRY_DELAYS_MS.length).toBeGreaterThan(3);
    expect(REVEAL_RETRY_DELAYS_MS.at(-1)).toBeLessThanOrEqual(3200);
  });
});
