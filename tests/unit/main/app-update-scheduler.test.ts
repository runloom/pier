import { createAppUpdateScheduler } from "@main/services/app-updates/app-update-scheduler.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("AppUpdateScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a no-op when disabled", () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => undefined);
    const scheduler = createAppUpdateScheduler({
      check,
      enabled: false,
      initialDelayMs: 1000,
      intervalMs: 5000,
    });
    scheduler.start();
    scheduler.onFocusGained();
    vi.advanceTimersByTime(60_000);
    expect(check).not.toHaveBeenCalled();
  });

  it("checks after the initial delay then on the interval", async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => undefined);
    const scheduler = createAppUpdateScheduler({
      check,
      enabled: true,
      initialDelayMs: 30_000,
      intervalMs: 60_000,
    });
    scheduler.start();
    expect(check).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(check).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(2);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("checks on focus only when the interval has elapsed", async () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    const check = vi.fn(async () => undefined);
    const scheduler = createAppUpdateScheduler({
      check,
      enabled: true,
      initialDelayMs: 1000,
      intervalMs: 10_000,
      now: () => now,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(check).toHaveBeenCalledTimes(1);

    now += 3000;
    scheduler.onFocusGained();
    expect(check).toHaveBeenCalledTimes(1);

    now += 10_000;
    scheduler.onFocusGained();
    await Promise.resolve();
    await Promise.resolve();
    expect(check).toHaveBeenCalledTimes(2);
  });
});
