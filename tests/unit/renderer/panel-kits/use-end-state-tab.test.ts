import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import { emptyTaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTerminalEndStateTab } from "@/panel-kits/terminal/hooks/use-end-state-tab.ts";
import {
  resetTerminalEndStateStoreForTests,
  terminalEndStateForPanel,
  useTerminalEndStateStore,
} from "@/stores/terminal-end-state.store.ts";

function agentActivity(panelId: string): ForegroundActivity {
  return {
    agentId: "grok",
    kind: "agent",
    panelId,
    source: "hook",
    spawnedAt: 1,
    status: "ready",
    subagentCount: 0,
    updatedAt: 2,
    windowId: "main",
  };
}

function renderEndStateTab(
  panelId: string,
  activity: ForegroundActivity | undefined
) {
  return renderHook(
    (props: { activity: ForegroundActivity | undefined }) =>
      useTerminalEndStateTab({
        activeLaunchTab: undefined,
        activeLaunchTask: undefined,
        activity: props.activity,
        currentTaskOutput: undefined,
        effectiveCwd: null,
        panelId,
        projectRootPath: null,
        savedSession: null,
        selectedTaskRunId: null,
        taskRunsSnapshot: emptyTaskRunsSnapshot(),
      }),
    { initialProps: { activity } }
  );
}

describe("useTerminalEndStateTab EndState lifecycle", () => {
  afterEach(() => {
    resetTerminalEndStateStoreForTests();
  });

  it("clears EndState on non-agent → agent rising edge (agent revive)", () => {
    const panelId = "terminal-revive-end";
    act(() => {
      useTerminalEndStateStore.getState().upsertAgentEnd({
        agentId: "grok",
        exitCode: 0,
        panelId,
      });
    });
    expect(terminalEndStateForPanel(panelId)).toBeDefined();

    const { rerender } = renderEndStateTab(panelId, undefined);
    expect(terminalEndStateForPanel(panelId)).toBeDefined();

    act(() => {
      rerender({ activity: agentActivity(panelId) });
    });

    expect(terminalEndStateForPanel(panelId)).toBeUndefined();
  });

  it("does not clear EndState while FA stays agent during exit race", () => {
    const panelId = "terminal-exit-race";
    const { rerender } = renderEndStateTab(panelId, agentActivity(panelId));

    act(() => {
      useTerminalEndStateStore.getState().upsertAgentEnd({
        agentId: "grok",
        exitCode: 0,
        panelId,
      });
    });
    expect(terminalEndStateForPanel(panelId)).toBeDefined();

    // 仍是 agent：模拟 child-exited 先于 FA 清空。不得 clear。
    act(() => {
      rerender({ activity: agentActivity(panelId) });
    });
    expect(terminalEndStateForPanel(panelId)).toBeDefined();

    // FA 清空进入结果查看：保留 EndState
    act(() => {
      rerender({ activity: undefined });
    });
    expect(terminalEndStateForPanel(panelId)).toBeDefined();
  });

  it("clears EndState on mount when already live agent (stale result)", () => {
    const panelId = "terminal-mount-live";
    act(() => {
      useTerminalEndStateStore.getState().upsertAgentEnd({
        agentId: "grok",
        exitCode: 1,
        panelId,
      });
    });

    renderEndStateTab(panelId, agentActivity(panelId));

    expect(terminalEndStateForPanel(panelId)).toBeUndefined();
  });
});
