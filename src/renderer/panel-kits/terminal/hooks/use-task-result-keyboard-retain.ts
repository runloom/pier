import {
  isActiveTaskRunNodeStatus,
  selectedTaskOutputRunId,
} from "@shared/contracts/tasks.ts";
import { type RefObject, useEffect, useState } from "react";
import { taskOutputFromParams } from "@/panel-kits/terminal/panel-params.ts";
import { shouldRetainTaskResultPanel } from "@/panel-kits/terminal/should-retain-task-result-panel.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import {
  taskRunsOwnedByPanel,
  useTaskRunsStore,
} from "@/stores/task-runs.store.ts";
import { useTerminalEndStateStore } from "@/stores/terminal-end-state.store.ts";
import { requestTerminalWebFocus } from "@/stores/terminal-input-routing-slice.ts";

/**
 * After terminal→web keyboard handoff, main calls webContents.focus().
 * Chromium then parks document focus on the first tabbable chrome control
 * (often the tab-strip "+"). Re-focus a panel sink so keys stay off Ghostty
 * without lighting up chrome tooltips.
 *
 * Handoff blur/focus settles in tens of ms (see WEB_FOCUS_HAND_OFF_BLUR_SUPPRESS_MS).
 */
const PARK_FOCUS_AFTER_HANDOFF_MS = 50;

function parkKeyboardOnSink(sink: HTMLElement | null | undefined): void {
  if (!sink) {
    return;
  }
  if (sink.tabIndex < 0 && !sink.hasAttribute("tabindex")) {
    sink.tabIndex = -1;
  }
  sink.focus({ preventScroll: true });
}

/**
 * Task / Task Output / Agent 结果查看态：
 * - 不任意键 / 回车关 panel（显式 ⌘W / 关 tab / 运行控制「关闭」）
 * - 进程终态后把键盘钉到 web，避免键落入 Ghostty child_exited → close surface
 * - 焦点停在 panel 根，不落到标签栏「+」等 chrome
 *
 * resultView 以 EndState / 任务终态为准，不依赖「retain 为 true 时才订 child-exited」
 * （FA 先清、child-exited 后到时仍能 park）。
 *
 * 活体 agent（FA kind=agent，含 ready/processing 回合）不得钉键盘：
 * EndState / child-exited 闩在同 panel 再次跑 agent 后可能仍残留，若继续
 * task-result-retain 会把 effective 永久钉在 web（诊断 owner-stuck），
 * 终端无法聚焦、TUI 快捷键失效。对齐 tab 的 agentEndView：仅 FA 非 agent 时
 * 才进入结果查看键盘态。
 */
export function useTaskResultKeyboardRetain(
  panelId: string,
  params: unknown,
  isActive: boolean,
  focusSinkRef?: RefObject<HTMLElement | null>,
  options?: {
    hasAgentSession?: boolean | undefined;
  }
): void {
  const hasEndState = useTerminalEndStateStore((s) => s.ends[panelId] != null);
  // 订阅 FA / TaskRuns，避免 shouldRetain 内 getState 无订阅导致 retain 卡住
  const activityKind = useForegroundActivityStore(
    (s) => s.activities[panelId]?.kind
  );
  useTaskRunsStore((s) => s.snapshot.version);
  const hasAgentSession = options?.hasAgentSession === true;
  const retain = shouldRetainTaskResultPanel(panelId, params, {
    hasAgentSession,
  });
  const [childExited, setChildExited] = useState(false);
  const liveAgent = activityKind === "agent";

  // 整段 mount 都订 child-exited；panelId 变才复位（勿因 retain 抖动丢事件）
  useEffect(() => {
    setChildExited(false);
    return window.pier.terminal.onChildExited((event) => {
      if (event.panelId === panelId) {
        setChildExited(true);
      }
    });
  }, [panelId]);

  const runActive = useTaskRunsStore((state) => {
    if (!retain) {
      return false;
    }
    const taskOutput = taskOutputFromParams(params);
    if (taskOutput) {
      const runId = selectedTaskOutputRunId(taskOutput);
      const taskId = taskOutput.taskId;
      const run = state.snapshot.runs[runId];
      if (!run) {
        return false;
      }
      const status = run.nodes[taskId]?.status ?? run.status;
      return isActiveTaskRunNodeStatus(status);
    }
    const owned = taskRunsOwnedByPanel(state.snapshot, panelId);
    if (owned.length === 0) {
      return false;
    }
    return owned.some((run) => isActiveTaskRunNodeStatus(run.status));
  });

  const runFinishedKnown = useTaskRunsStore((state) => {
    if (!retain) {
      return false;
    }
    const taskOutput = taskOutputFromParams(params);
    if (taskOutput) {
      const runId = selectedTaskOutputRunId(taskOutput);
      const taskId = taskOutput.taskId;
      const run = state.snapshot.runs[runId];
      if (!run) {
        return false;
      }
      const status = run.nodes[taskId]?.status ?? run.status;
      return !isActiveTaskRunNodeStatus(status);
    }
    const owned = taskRunsOwnedByPanel(state.snapshot, panelId);
    if (owned.length === 0) {
      return false;
    }
    return owned.every((run) => !isActiveTaskRunNodeStatus(run.status));
  });

  useEffect(() => {
    if (runActive) {
      setChildExited(false);
    }
  }, [runActive]);

  // 同 panel 再次成为活体 agent 时清掉 child-exited 闩。
  // EndState 本体由 useTerminalEndStateTab 在「非 agent → agent」上升沿清除
  // （持续 agent 时不 clear，避免退出竞态丢掉刚写入的结果态）。
  useEffect(() => {
    if (liveAgent) {
      setChildExited(false);
    }
  }, [liveAgent]);

  // 活体 agent 时即使残留 EndState 也不得钉键盘（与 agentEndView 同口径）。
  // EndState 上升沿清除后，FA 短暂 empty 抖动也不会因旧 hasEndState 再 pin。
  const resultView =
    retain &&
    !runActive &&
    !liveAgent &&
    (runFinishedKnown || childExited || hasEndState);

  useEffect(() => {
    if (!(isActive && resultView)) {
      return;
    }
    const releaseWebFocus = requestTerminalWebFocus(
      `task-result-retain:${panelId}`
    );
    parkKeyboardOnSink(focusSinkRef?.current);
    const handoffTimer = window.setTimeout(() => {
      parkKeyboardOnSink(focusSinkRef?.current);
    }, PARK_FOCUS_AFTER_HANDOFF_MS);

    return () => {
      window.clearTimeout(handoffTimer);
      releaseWebFocus();
    };
  }, [focusSinkRef, isActive, panelId, resultView]);
}
