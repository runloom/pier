import { createForegroundActivityAggregator } from "@main/services/foreground-activity/aggregator.ts";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAgentComposerEligibleForPanel,
  shouldMountAgentComposer,
} from "@/panel-kits/terminal/composer-mount.ts";
import { useTaskResultKeyboardRetain } from "@/panel-kits/terminal/hooks/use-task-result-keyboard-retain.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import {
  resetTerminalEndStateStoreForTests,
  useTerminalEndStateStore,
} from "@/stores/terminal-end-state.store.ts";
import { requestTerminalWebFocus } from "@/stores/terminal-input-routing-slice.ts";

vi.mock("@/stores/terminal-input-routing-slice.ts", () => ({
  requestTerminalWebFocus: vi.fn(() => vi.fn()),
}));

const panelId = "terminal-codex";
const hookOptions = {
  evidenceSource: "hook",
  stopAuthority: "advisory",
  turnStartAuthority: "none",
} as const;
const sessionEvent: AgentHookEventPayloadV3 = {
  agent: "codex",
  event: "SessionStart",
  kind: "agentEvent",
  nativeEvent: "SessionStart",
  panelId,
  sessionId: "old-conversation",
  spawnGeneration: 1,
  tty: "ttys004",
  v: 3,
  windowId: "1",
};

describe("agent conversation and terminal input lifetime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(requestTerminalWebFocus).mockClear();
    vi.stubGlobal("pier", {
      terminal: { onChildExited: vi.fn(() => vi.fn()) },
    });
    useForegroundActivityStore.setState({ activities: {}, ts: 0 });
    useTaskRunsStore.setState({
      initialized: true,
      snapshot: { runs: {}, version: 1 },
    });
    resetTerminalEndStateStoreForTests();
  });

  afterEach(() => {
    cleanup();
    resetTerminalEndStateStoreForTests();
    useForegroundActivityStore.setState({ activities: {}, ts: 0 });
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([
    false,
    true,
  ])("keeps typing and enhanced input available after SessionEnd (stale result: %s)", (staleResult) => {
    const aggregator = createForegroundActivityAggregator();
    const mirrorActivity = () =>
      useForegroundActivityStore.getState().apply(aggregator.snapshot());
    try {
      aggregator.agentLaunched("1", panelId, "codex");
      vi.advanceTimersByTime(250);
      aggregator.ingestAgentEvent(sessionEvent, hookOptions);
      mirrorActivity();
      if (staleResult) {
        useTerminalEndStateStore
          .getState()
          .upsertAgentEnd({ agentId: "codex", panelId });
      }
      renderHook(() =>
        useTaskResultKeyboardRetain(panelId, undefined, true, undefined, {
          hasAgentSession: true,
        })
      );

      act(() => {
        aggregator.ingestAgentEvent(
          { ...sessionEvent, event: "SessionEnd" },
          hookOptions
        );
        mirrorActivity();
      });

      expect(isAgentComposerEligibleForPanel(panelId)).toBe(true);
      expect(
        shouldMountAgentComposer({
          activityKind:
            useForegroundActivityStore.getState().activities[panelId]?.kind,
          open: true,
          restored: false,
        })
      ).toBe(true);
      expect(requestTerminalWebFocus).not.toHaveBeenCalled();

      act(() => {
        aggregator.ptyExited(panelId, "1");
        mirrorActivity();
        useTerminalEndStateStore.getState().upsertAgentEnd({
          agentId: "codex",
          exitCode: 0,
          panelId,
        });
      });

      expect(isAgentComposerEligibleForPanel(panelId)).toBe(false);
      expect(requestTerminalWebFocus).toHaveBeenCalledWith(
        `task-result-retain:${panelId}`
      );
    } finally {
      aggregator.dispose();
    }
  });
});
