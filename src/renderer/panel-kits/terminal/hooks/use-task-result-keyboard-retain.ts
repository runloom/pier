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
  useForegroundActivityStore((s) => s.activities[panelId]?.kind);
  useTaskRunsStore((s) => s.snapshot.version);
  const hasAgentSession = options?.hasAgentSession === true;
  const retain = shouldRetainTaskResultPanel(panelId, params, {
    hasAgentSession,
  });
  const [childExited, setChildExited] = useState(false);

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

  const resultView =
    retain && !runActive && (runFinishedKnown || childExited || hasEndState);

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
