import {
  cancelPromptReady,
  schedulePromptReady,
  signalPromptReady,
  viewportHasPaintedPrompt,
} from "@main/ipc/terminal/initial-input-gate.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("viewportHasPaintedPrompt", () => {
  it("rejects empty and login-banner-only viewports", () => {
    expect(viewportHasPaintedPrompt(undefined)).toBe(false);
    expect(viewportHasPaintedPrompt("")).toBe(false);
    expect(
      viewportHasPaintedPrompt("Last login: Sat Aug 15 15:03:30 on ttys012")
    ).toBe(false);
  });

  it("accepts a painted starship or simple shell prompt", () => {
    expect(
      viewportHasPaintedPrompt(
        "Last login: Sat Aug 15 15:03:30 on ttys012\nloomdesk  feat/main-20260611 (base) is 📦 v0.1.0"
      )
    ).toBe(true);
    expect(viewportHasPaintedPrompt("%")).toBe(true);
    expect(viewportHasPaintedPrompt("$ ")).toBe(true);
  });
});

describe("terminal initial-input gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits until the viewport shows a painted prompt after OSC 7", () => {
    const fire = vi.fn();
    let viewport = "Last login: Sat Aug 15 15:03:30 on ttys012\n";
    schedulePromptReady("panel-1", fire, 1500, {
      isPainted: () => viewportHasPaintedPrompt(viewport),
    });
    signalPromptReady("panel-1");
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(fire).not.toHaveBeenCalled();
    viewport =
      "Last login: Sat Aug 15 15:03:30 on ttys012\nloomdesk  feat/main (base) is v0.1.0";
    vi.advanceTimersByTime(50);
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

  it("cancelPromptReady during prompt-paint poll prevents a late inject", () => {
    const fire = vi.fn();
    schedulePromptReady("panel-1", fire, 1500, {
      isPainted: () => false,
    });
    signalPromptReady("panel-1");
    cancelPromptReady("panel-1");
    vi.advanceTimersByTime(400);
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
