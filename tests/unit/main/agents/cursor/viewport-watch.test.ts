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
});
