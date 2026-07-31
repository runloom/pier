import { handleMainStartupFailure } from "@main/app-startup-failure.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.useRealTimers());

describe("main startup failure", () => {
  it("shows one localized error, attempts every cleanup, and exits", async () => {
    const events: string[] = [];
    const log = vi.fn();
    const showError = vi.fn();
    const exit = vi.fn();

    await handleMainStartupFailure({
      cleanupTasks: [
        {
          label: "first",
          run: () => {
            events.push("first");
            throw new Error("first cleanup failed");
          },
        },
        {
          label: "second",
          run: () => {
            events.push("second");
          },
        },
      ],
      error: new AggregateError(
        [new Error("plugin host failed")],
        "startup failed"
      ),
      exit,
      isChinese: true,
      log,
      showError,
    });

    expect(showError).toHaveBeenCalledOnce();
    expect(showError).toHaveBeenCalledWith(
      "Pier 启动失败",
      expect.stringContaining("plugin host failed")
    );
    expect(events).toEqual(["first", "second"]);
    expect(log).toHaveBeenCalledWith(
      "main startup cleanup failed: first",
      expect.any(Error)
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits after the cleanup deadline even when one cleanup hangs", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const exit = vi.fn();
    const handling = handleMainStartupFailure({
      cleanupTasks: [
        { label: "hanging", run: () => new Promise(() => undefined) },
        { label: "completed", run: () => undefined },
      ],
      cleanupTimeoutMs: 25,
      error: new Error("startup failed"),
      exit,
      isChinese: false,
      log,
      showError: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(25);
    await handling;

    expect(log).toHaveBeenCalledWith(
      "main startup cleanup timed out: hanging",
      expect.any(Error)
    );
    expect(exit).toHaveBeenCalledWith(1);
  });
});
