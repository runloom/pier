import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type { PanelTabChrome } from "@shared/contracts/panel.ts";
import type {
  TaskOutputPanelParams,
  TaskPanelMetadata,
  TaskRunsSnapshot,
} from "@shared/contracts/tasks.ts";
import type { TerminalEndState } from "@shared/contracts/terminal/end-state.ts";
import type { TerminalPanelSessionSnapshot } from "@shared/contracts/terminal.ts";
import { useEffect, useMemo } from "react";
import { useTerminalEndStateStore } from "@/stores/terminal-end-state.store.ts";
import {
  activityTabChromeOverlay,
  mergeTabChrome,
  taskOutputTabChromeOverlay,
  taskRunTabChromeOverlay,
} from "../tab-chrome.ts";

/**
 * Hydrate agent EndState from session + derive effective tab chrome.
 * Keeps terminal-panel.tsx under the file-size hard cap.
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

  useEffect(
    () => () => {
      clearEndState(panelId);
    },
    [clearEndState, panelId]
  );

  const agentEndView = endState?.role === "agent" && activity?.kind !== "agent";
  const baseTab =
    endState && activity?.kind !== "agent"
      ? endState.tab
      : (savedSession?.tab ?? activeLaunchTab);

  const effectiveTab = useMemo(
    () =>
      mergeTabChrome(
        mergeTabChrome(
          mergeTabChrome(
            baseTab,
            activity?.kind === "agent"
              ? activityTabChromeOverlay(activity, {
                  cwd: args.effectiveCwd,
                  projectRootPath: args.projectRootPath,
                  sessionTitle: savedSession?.sessionTitle,
                  sessionTitleSource: savedSession?.sessionTitleSource,
                  taskRuns: args.taskRunsSnapshot,
                })
              : null
          ),
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
      ),
    [
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
    ]
  );

  return { effectiveTab, endState };
}
