import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CURSOR_VIEWPORT_RESIZE_POLL_FALLBACK_MS,
  isCursorViewportPollPaused,
  resetCursorViewportPollGateForTests,
  setCursorViewportResizePollPaused,
} from "../../../../../src/main/services/agents/integrations/transcript/cursor-viewport-poll-gate.ts";

describe("cursor viewport poll gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCursorViewportPollGateForTests();
  });

  afterEach(() => {
    resetCursorViewportPollGateForTests();
    vi.useRealTimers();
  });

  it("pauses per window and unpauses independently", () => {
    setCursorViewportResizePollPaused(1, true);
    setCursorViewportResizePollPaused(2, true);
    expect(isCursorViewportPollPaused()).toBe(true);
    setCursorViewportResizePollPaused(1, false);
    expect(isCursorViewportPollPaused()).toBe(true);
    setCursorViewportResizePollPaused(2, false);
    expect(isCursorViewportPollPaused()).toBe(false);
  });

  it("clears a missed resized after the fallback window", () => {
    setCursorViewportResizePollPaused(1, true);
    expect(isCursorViewportPollPaused()).toBe(true);
    vi.advanceTimersByTime(CURSOR_VIEWPORT_RESIZE_POLL_FALLBACK_MS - 1);
    expect(isCursorViewportPollPaused()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isCursorViewportPollPaused()).toBe(false);
  });

  it("renews the fallback when resize stays active", () => {
    setCursorViewportResizePollPaused(1, true);
    vi.advanceTimersByTime(CURSOR_VIEWPORT_RESIZE_POLL_FALLBACK_MS - 1);
    setCursorViewportResizePollPaused(1, true);
    vi.advanceTimersByTime(CURSOR_VIEWPORT_RESIZE_POLL_FALLBACK_MS - 1);
    expect(isCursorViewportPollPaused()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isCursorViewportPollPaused()).toBe(false);
  });
});
