import type { AgentHookEventPayloadV1 } from "@shared/contracts/agent/session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cursorTranscriptScopeKey } from "../../../../../src/main/services/agents/integrations/transcript/cursor-question.ts";
import { createCursorViewportWatch } from "../../../../../src/main/services/agents/integrations/transcript/cursor-viewport-watch.ts";

function context(
  overrides: Partial<AgentHookEventPayloadV1> = {}
): AgentHookEventPayloadV1 {
  return {
    agent: "cursor",
    event: "PromptSubmit",
    kind: "agentEvent",
    panelId: "panel-1",
    sessionId: "session-1",
    windowId: "1",
    ...overrides,
    v: 1,
  };
}

describe("cursor viewport watch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls the latest context every 250ms and stops on demand", async () => {
    const sync = vi.fn();
    const watch = createCursorViewportWatch({ enabled: true, sync });
    const first = context();
    watch.start(first);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenLastCalledWith(first);

    const refreshed = context({ event: "ToolStart" });
    watch.start(refreshed);
    expect(sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(sync).toHaveBeenLastCalledWith(refreshed);

    watch.stop(cursorTranscriptScopeKey(first));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(watch.lastContextByScope.size).toBe(0);
  });

  it("disabled watch tracks contexts for release bookkeeping without polling", async () => {
    const sync = vi.fn();
    const watch = createCursorViewportWatch({ enabled: false, sync });
    const event = context();
    const key = cursorTranscriptScopeKey(event);
    watch.start(event);
    expect(watch.lastContextByScope.get(key)).toBe(event);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sync).not.toHaveBeenCalled();

    watch.stop(key);
    expect(watch.lastContextByScope.size).toBe(0);
  });

  it("transfer rekeys the context and keeps polling under the new window", async () => {
    const sync = vi.fn();
    const watch = createCursorViewportWatch({ enabled: true, sync });
    const source = context();
    watch.start(source);
    sync.mockClear();

    const sourceKey = cursorTranscriptScopeKey(source);
    const targetKey = cursorTranscriptScopeKey(context({ windowId: "2" }));
    watch.transfer(sourceKey, targetKey, "2");
    expect(watch.lastContextByScope.has(sourceKey)).toBe(false);
    expect(watch.lastContextByScope.get(targetKey)).toMatchObject({
      panelId: "panel-1",
      windowId: "2",
    });

    await vi.advanceTimersByTimeAsync(250);
    expect(sync).toHaveBeenLastCalledWith(
      expect.objectContaining({ windowId: "2" })
    );
  });

  it("transfer without a timer moves the context but does not start polling", async () => {
    const sync = vi.fn();
    const watch = createCursorViewportWatch({ enabled: false, sync });
    const source = context();
    watch.start(source);

    const sourceKey = cursorTranscriptScopeKey(source);
    const targetKey = cursorTranscriptScopeKey(context({ windowId: "2" }));
    watch.transfer(sourceKey, targetKey, "2");
    expect(watch.lastContextByScope.get(targetKey)).toMatchObject({
      windowId: "2",
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sync).not.toHaveBeenCalled();
  });

  it("dispose stops every timer and clears all contexts", async () => {
    const sync = vi.fn();
    const watch = createCursorViewportWatch({ enabled: true, sync });
    watch.start(context());
    watch.start(context({ panelId: "panel-2" }));
    sync.mockClear();

    watch.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sync).not.toHaveBeenCalled();
    expect(watch.lastContextByScope.size).toBe(0);
  });

  it("reschedules after sync throws so the scope keeps polling", async () => {
    const sync = vi.fn();
    sync.mockImplementationOnce(() => undefined);
    sync.mockImplementationOnce(() => {
      throw new Error("dump failed");
    });
    const watch = createCursorViewportWatch({ enabled: true, sync });
    watch.start(context());
    expect(sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(250);
    expect(sync).toHaveBeenCalledTimes(3);
    watch.dispose();
  });

  it("skips ticks while shouldSkipTick is true without dropping the schedule", async () => {
    const sync = vi.fn();
    let skip = true;
    const watch = createCursorViewportWatch({
      enabled: true,
      shouldSkipTick: () => skip,
      sync,
    });
    watch.start(context());
    expect(sync).toHaveBeenCalledTimes(1);
    sync.mockClear();

    await vi.advanceTimersByTimeAsync(750);
    expect(sync).not.toHaveBeenCalled();

    skip = false;
    await vi.advanceTimersByTimeAsync(250);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("backs off the poll interval after a slow dump and recovers", async () => {
    let dumpMs = 25;
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const timedSync = vi.fn(() => {
      now += dumpMs;
    });
    const watch = createCursorViewportWatch({
      enabled: true,
      sync: timedSync,
    });
    watch.start(context({ panelId: "slow" }));
    timedSync.mockClear();

    // 250ms base → slow dump → interval 500
    now = 0;
    await vi.advanceTimersByTimeAsync(250);
    expect(timedSync).toHaveBeenCalledTimes(1);

    // Next tick waits 500ms
    now = 0;
    await vi.advanceTimersByTimeAsync(499);
    expect(timedSync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(timedSync).toHaveBeenCalledTimes(2);

    // Still slow → interval 1000
    dumpMs = 1;
    now = 0;
    await vi.advanceTimersByTimeAsync(999);
    expect(timedSync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(timedSync).toHaveBeenCalledTimes(3);

    // Fast dump recovered → interval 250
    now = 0;
    await vi.advanceTimersByTimeAsync(250);
    expect(timedSync).toHaveBeenCalledTimes(4);

    watch.dispose();
  });
});
