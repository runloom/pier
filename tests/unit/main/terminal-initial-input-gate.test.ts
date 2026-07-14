import {
  cancelPromptReady,
  schedulePromptReady,
  signalPromptReady,
} from "@main/ipc/terminal-initial-input-gate.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("terminal initial-input gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires immediately when signalPromptReady arrives before the fallback timer", () => {
    const fire = vi.fn();
    schedulePromptReady("panel-1", fire, 1500);
    signalPromptReady("panel-1");
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("fires via fallback timer when no prompt signal arrives", () => {
    const fire = vi.fn();
    schedulePromptReady("panel-1", fire, 500);
    vi.advanceTimersByTime(400);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("consumes the pending entry so second prompt signal is a no-op", () => {
    const fire = vi.fn();
    schedulePromptReady("panel-1", fire, 1500);
    signalPromptReady("panel-1");
    signalPromptReady("panel-1");
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("cancelPromptReady clears the fallback timer to prevent late injection", () => {
    const fire = vi.fn();
    schedulePromptReady("panel-1", fire, 500);
    cancelPromptReady("panel-1");
    vi.advanceTimersByTime(2000);
    expect(fire).not.toHaveBeenCalled();
  });

  it("scheduling the same panelId twice replaces the earlier pending fire", () => {
    const firstFire = vi.fn();
    const secondFire = vi.fn();
    schedulePromptReady("panel-1", firstFire, 500);
    schedulePromptReady("panel-1", secondFire, 500);
    signalPromptReady("panel-1");
    expect(firstFire).not.toHaveBeenCalled();
    expect(secondFire).toHaveBeenCalledTimes(1);
  });

  it("keeps prompt gates independent across panels", () => {
    const fireA = vi.fn();
    const fireB = vi.fn();
    schedulePromptReady("a", fireA, 500);
    schedulePromptReady("b", fireB, 500);
    signalPromptReady("a");
    expect(fireA).toHaveBeenCalledTimes(1);
    expect(fireB).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(fireB).toHaveBeenCalledTimes(1);
  });
});
