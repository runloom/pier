import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type { PanelTabChrome } from "@shared/contracts/panel.ts";
import type {
  TaskOutputPanelParams,
  TaskPanelMetadata,
  TaskRunsSnapshot,
} from "@shared/contracts/tasks.ts";
import type { TerminalEndState } from "@shared/contracts/terminal/end-state.ts";
import type { TerminalPanelSessionSnapshot } from "@shared/contracts/terminal.ts";
import { useEffect, useMemo, useRef } from "react";
import { useTerminalEndStateStore } from "@/stores/terminal-end-state.store.ts";
import {
  activityTabChromeOverlay,
  mergeTabChrome,
  stripTabChromeTitle,
  taskOutputTabChromeOverlay,
  taskRunTabChromeOverlay,
} from "../tab-chrome.ts";

/**
 * Hydrate agent EndState from session + derive effective tab chrome.
 * Keeps terminal-panel.tsx under the file-size hard cap.
 *
 * EndState 生命周期：
 * - 水合：session.agent.exited 且当前非活体 agent
 * - 清除：panel unmount；**非 agent → agent 上升沿**（同 panel 复活）
 * - 不在「持续 FA=agent」期间 clear：进程退出瞬间 child-exited 可能先于 FA
 *   清空写入 EndState，若此时无脑 clear 会丢掉结果查看态
 */
export function useTerminalEndStateTab(args: {
  activeLaunchTab: PanelTabChrome | undefined;
  activeLaunchTask: TaskPanelMetadata | undefined;
  activity: ForegroundActivity | undefined;
  currentTaskOutput: TaskOutputPanelParams | undefined;
  effectiveCwd: string | null;
  projectRootPath: string | null | undefined;
  panelId: string;
  savedSession: TerminalPanelSessionSnapshot | null | undefined;
  selectedTaskRunId: string | null | undefined;
  taskRunsSnapshot: TaskRunsSnapshot;
}): {
  effectiveTab: PanelTabChrome | undefined;
  endState: TerminalEndState | undefined;
} {
  const { panelId, activity, savedSession, activeLaunchTab } = args;
  const endState = useTerminalEndStateStore((s) => s.ends[panelId]);
  const upsertAgentEnd = useTerminalEndStateStore((s) => s.upsertAgentEnd);
  const clearEndState = useTerminalEndStateStore((s) => s.clear);
  /** 上一帧是否 FA kind=agent；用于复活上升沿，避免退出竞态误清。 */
  const prevLiveAgentRef = useRef(false);

  useEffect(() => {
    if (activity?.kind === "agent") {
      return;
    }
    const agent = savedSession?.agent;
    if (!(agent?.agentId && agent.status === "exited")) {
      return;
    }
    upsertAgentEnd({
      agentId: agent.agentId,
      ...(agent.exitCode === undefined ? {} : { exitCode: agent.exitCode }),
      ...(agent.finishedAt === undefined
        ? {}
        : { finishedAt: agent.finishedAt }),
      panelId,
      title: savedSession?.tab?.title ?? activeLaunchTab?.title,
    });
  }, [
    activeLaunchTab?.title,
    activity?.kind,
    panelId,
    savedSession?.agent,
    savedSession?.tab?.title,
    upsertAgentEnd,
  ]);

  // panel 切换：复位上升沿哨兵 + unmount/换 id 时清本 panel EndState。
  // 必须排在复活 clear 之前声明，保证同 commit 先 reset 再判 rising edge。
  useEffect(() => {
    prevLiveAgentRef.current = false;
    return () => {
      clearEndState(panelId);
    };
  }, [clearEndState, panelId]);

  // 同 panel agent 复活（非 agent → agent）：清残留 EndState，避免 FA 抖动时空窗
  // 再被 hasEndState 钉回键盘 / 结果 chrome。持续 agent 或 agent→empty 退出不 clear。
  useEffect(() => {
    const liveAgent = activity?.kind === "agent";
    if (liveAgent && !prevLiveAgentRef.current) {
      clearEndState(panelId);
    }
    prevLiveAgentRef.current = liveAgent;
  }, [activity?.kind, clearEndState, panelId]);

  const agentEndView = endState?.role === "agent" && activity?.kind !== "agent";
  const baseTab =
    endState && activity?.kind !== "agent"
      ? endState.tab
      : (savedSession?.tab ?? activeLaunchTab);

  const effectiveTab = useMemo(() => {
    const agentOverlay =
      activity?.kind === "agent"
        ? activityTabChromeOverlay(activity, {
            cwd: args.effectiveCwd,
            projectRootPath: args.projectRootPath,
            sessionTitle: savedSession?.sessionTitle,
            sessionTitleSource: savedSession?.sessionTitleSource,
            taskRuns: args.taskRunsSnapshot,
          })
        : null;
    // 活体 agent 且无用户改名：剥掉启动/持久化 chrome 的 title，交给 OSC → cwd。
    const agentBaseTab =
      activity?.kind === "agent" && !agentOverlay?.title
        ? stripTabChromeTitle(baseTab)
        : baseTab;
    return mergeTabChrome(
      mergeTabChrome(
        mergeTabChrome(agentBaseTab, agentOverlay),
        agentEndView
          ? null
          : taskRunTabChromeOverlay(
              panelId,
              args.taskRunsSnapshot,
              savedSession?.task ?? args.activeLaunchTask,
              args.selectedTaskRunId
            )
      ),
      agentEndView
        ? null
        : taskOutputTabChromeOverlay(
            args.currentTaskOutput,
            args.taskRunsSnapshot
          )
    );
  }, [
    activity,
    agentEndView,
    args.activeLaunchTask,
    args.currentTaskOutput,
    args.effectiveCwd,
    args.projectRootPath,
    args.selectedTaskRunId,
    args.taskRunsSnapshot,
    baseTab,
    panelId,
    savedSession?.sessionTitle,
    savedSession?.sessionTitleSource,
    savedSession?.task,
  ]);

  return { effectiveTab, endState };
}
