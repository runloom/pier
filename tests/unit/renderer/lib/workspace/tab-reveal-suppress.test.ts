import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isTabRevealSuppressed,
  resetTabRevealSuppressionForTests,
  suppressTabRevealForCurrentInteraction,
  withSuppressedTabReveal,
} from "@/lib/workspace/tab-reveal-suppress.ts";
import { activateTerminalPanelFromFocusRequest } from "@/lib/workspace/terminal-focus-request.ts";

describe("tab reveal suppress", () => {
  afterEach(() => {
    resetTabRevealSuppressionForTests();
    vi.useRealTimers();
  });

  it("nests suppress depth and restores after the callback", () => {
    expect(isTabRevealSuppressed()).toBe(false);
    withSuppressedTabReveal(() => {
      expect(isTabRevealSuppressed()).toBe(true);
      withSuppressedTabReveal(() => {
        expect(isTabRevealSuppressed()).toBe(true);
      });
      expect(isTabRevealSuppressed()).toBe(true);
    });
    expect(isTabRevealSuppressed()).toBe(false);
  });

  it("suppresses during terminal focus request activation", () => {
    const setActive = vi.fn(() => {
      expect(isTabRevealSuppressed()).toBe(true);
    });
    activateTerminalPanelFromFocusRequest(
      {
        panels: [
          {
            api: { setActive },
            id: "terminal-1",
            view: { contentComponent: "terminal" },
          },
        ],
      },
      "terminal-1"
    );
    expect(setActive).toHaveBeenCalledOnce();
    expect(isTabRevealSuppressed()).toBe(false);
  });

  it("latches suppress until the current interaction turn ends", () => {
    vi.useFakeTimers();
    expect(isTabRevealSuppressed()).toBe(false);
    suppressTabRevealForCurrentInteraction();
    expect(isTabRevealSuppressed()).toBe(true);
    vi.runAllTimers();
    expect(isTabRevealSuppressed()).toBe(false);
  });

  it("rearms the interaction latch when called again in the same turn", () => {
    vi.useFakeTimers();
    suppressTabRevealForCurrentInteraction();
    vi.advanceTimersByTime(0);
    expect(isTabRevealSuppressed()).toBe(false);
    suppressTabRevealForCurrentInteraction();
    expect(isTabRevealSuppressed()).toBe(true);
    vi.runAllTimers();
    expect(isTabRevealSuppressed()).toBe(false);
  });

  it("clears a pending interaction latch in test reset", () => {
    vi.useFakeTimers();
    suppressTabRevealForCurrentInteraction();
    resetTabRevealSuppressionForTests();
    expect(isTabRevealSuppressed()).toBe(false);
    vi.runAllTimers();
    expect(isTabRevealSuppressed()).toBe(false);
  });
});
