import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmTerminalLaunch,
  resetTerminalLaunchConfirmationsForTest,
  TERMINAL_LAUNCH_CONFIRMATION_TIMEOUT_MS,
  waitForTerminalLaunch,
} from "@/lib/workspace/terminal-launch-confirmation.ts";

afterEach(() => {
  resetTerminalLaunchConfirmationsForTest();
  vi.useRealTimers();
});

describe("waitForTerminalLaunch", () => {
  it("waits long enough for sequential native creates", () => {
    expect(TERMINAL_LAUNCH_CONFIRMATION_TIMEOUT_MS).toBeGreaterThanOrEqual(
      15_000
    );
  });

  it("rejects when native create never confirms", async () => {
    vi.useFakeTimers();
    const pending = waitForTerminalLaunch("launch-slow");
    await vi.advanceTimersByTimeAsync(
      TERMINAL_LAUNCH_CONFIRMATION_TIMEOUT_MS - 1
    );
    await expect(
      Promise.race([pending, Promise.resolve("still-waiting")])
    ).resolves.toBe("still-waiting");
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).rejects.toThrow("terminal creation timed out");
  });

  it("resolves when native create confirms before the deadline", async () => {
    vi.useFakeTimers();
    const pending = waitForTerminalLaunch("launch-ok");
    confirmTerminalLaunch("launch-ok");
    await expect(pending).resolves.toBeUndefined();
  });
});
