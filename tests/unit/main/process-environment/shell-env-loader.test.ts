import { remainingTimeoutMs } from "@main/services/process-environment/shell-env-loader.ts";
import { describe, expect, it } from "vitest";

describe("remainingTimeoutMs", () => {
  it("returns remaining budget until shared deadline", () => {
    const deadline = 1_000_000;
    expect(remainingTimeoutMs(deadline, 999_000)).toBe(1000);
    expect(remainingTimeoutMs(deadline, 1_000_000)).toBe(1);
    expect(remainingTimeoutMs(deadline, 1_000_500)).toBe(1);
  });
});
