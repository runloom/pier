import { requireAppCoreInitialization } from "@main/app-core/app-core-readiness.ts";
import { describe, expect, it, vi } from "vitest";

describe("requireAppCoreInitialization", () => {
  it("resolves only after initialization succeeds", async () => {
    const reportFailure = vi.fn();

    await expect(
      requireAppCoreInitialization(Promise.resolve(), reportFailure)
    ).resolves.toBeUndefined();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("reports and propagates initialization failure", async () => {
    const failure = new Error("managed plugin index is unavailable");
    const reportFailure = vi.fn();

    await expect(
      requireAppCoreInitialization(Promise.reject(failure), reportFailure)
    ).rejects.toBe(failure);
    expect(reportFailure).toHaveBeenCalledWith(failure);
  });
});
