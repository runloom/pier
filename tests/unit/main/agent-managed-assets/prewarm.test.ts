import {
  prewarmMemoryEngine,
  resetMemoryEnginePrewarmForTests,
} from "@main/services/agent-managed-assets/prewarm.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("memory engine prewarm", () => {
  beforeEach(() => {
    resetMemoryEnginePrewarmForTests();
  });

  it("runs once for the whole process after a success", async () => {
    const runner = vi.fn(() => Promise.resolve());
    await prewarmMemoryEngine(runner);
    await prewarmMemoryEngine(runner);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent calls onto one in-flight run", async () => {
    let release: () => void = () => undefined;
    const runner = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const first = prewarmMemoryEngine(runner);
    const second = prewarmMemoryEngine(runner);
    release();
    await Promise.all([first, second]);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("swallows failure and retries on the next enable event", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const runner = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    await expect(prewarmMemoryEngine(runner)).resolves.toBeUndefined();
    await prewarmMemoryEngine(runner);
    expect(runner).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});
