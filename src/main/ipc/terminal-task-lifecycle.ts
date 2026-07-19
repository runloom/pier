import type { PanelTabChrome } from "@shared/contracts/panel.ts";
import type {
  TaskExitReason,
  TaskExitSource,
  TaskPanelStatus,
} from "@shared/contracts/tasks.ts";
import {
  type TerminalTaskExitStatus,
  taskExitTabPatch,
} from "./terminal-tab-chrome.ts";

export interface TerminalTaskLifecycleDeps {
  completePanel(
    panelId: string,
    exitCode: number,
    lifecycleId: string,
    windowId?: string | undefined
  ): Promise<unknown>;
  isStopRequested?(panelId: string, windowId?: string | undefined): boolean;
  markPanelClosed(panelId: string, windowId?: string | undefined): void;
  now(): number;
  patchTab(
    sessionScope: string,
    panelId: string,
    tab: Partial<PanelTabChrome>
  ): Promise<void>;
  patchTaskStatus(
    sessionScope: string,
    panelId: string,
    lifecycleId: string,
    patch: {
      exitCode?: number | undefined;
      exitReason?: TaskExitReason | undefined;
      exitSource?: TaskExitSource | undefined;
      finishedAt?: number | undefined;
      status: TaskPanelStatus;
    }
  ): Promise<boolean>;
  sessionScopeForBrowserWindow(browserWindowId: number): string | null;
}

export interface ExitCodeHintArgs {
  browserWindowId: number;
  code: number;
  lifecycleId: string;
  panelId: string;
  source: Extract<
    TaskExitSource,
    "shell-command-finished" | "task-exit-marker"
  >;
  windowId?: string | undefined;
}

type ImmediateExitCodeHintArgs = ExitCodeHintArgs & {
  source: Extract<
    TaskExitSource,
    "shell-command-finished" | "task-exit-marker"
  >;
};

export interface NativeProcessCloseArgs {
  browserWindowId: number;
  lifecycleId: string;
  panelId: string;
  processAlive: boolean;
  windowId?: string | undefined;
}

interface FinishArgs {
  browserWindowId: number;
  code?: number | undefined;
  lifecycleId: string;
  panelId: string;
  reason: TaskExitReason;
  source: TaskExitSource;
  windowId?: string | undefined;
}

function panelKey(panelId: string, windowId?: string | undefined): string {
  return windowId ? `${windowId}\0${panelId}` : panelId;
}

function lifecycleKey(
  panelId: string,
  lifecycleId: string,
  windowId?: string | undefined
): string {
  return `${panelKey(panelId, windowId)}\0${lifecycleId}`;
}

function statusForExit(exit: TerminalTaskExitStatus): TaskPanelStatus {
  if (exit.reason === "user") {
    return "cancelled";
  }
  return exit.code === 0 ? "succeeded" : "failed";
}

function normalizedCompletionCode(code: number | undefined): number {
  return typeof code === "number" && code >= 0 ? code : 1;
}

/**
 * Native shell 回调协调器：
 * - 排序 task-exit-marker 与 shell-command-finished 两路 exit code hint（前者胜）
 * - Dedupe 同 panel 的多路终结事件（native process close + exit code hint）
 * - 记录 launcher/panel 侧「预期用户主动关闭」（`ignoreNextNativeUserClose`）
 * - 终结时把状态写入 terminal-session-state.json（`patchTaskStatus` + `patchTab`，
 *   restore-on-restart 单源）。
 *
 * 不负责活动 broadcast：任务活动投影统一走
 * `foregroundActivityService.taskFinished` → `ForegroundActivityAggregator`。
 */
export function createTerminalTaskLifecycle(deps: TerminalTaskLifecycleDeps) {
  const exitCodeHints = new Map<string, ExitCodeHintArgs>();
  const finishedPanels = new Set<string>();
  const inFlightPanels = new Set<string>();
  const ignoredNativeUserClosePanels = new Set<string>();
  const currentLifecycleIds = new Map<string, string>();

  const clearPanelLifecycleState = (
    panelId: string,
    windowId?: string | undefined
  ): void => {
    const panel = panelKey(panelId, windowId);
    const prefix = `${panel}\0`;
    for (const collection of [
      exitCodeHints,
      finishedPanels,
      inFlightPanels,
      ignoredNativeUserClosePanels,
    ]) {
      for (const key of collection.keys()) {
        if (key.startsWith(prefix)) {
          collection.delete(key);
        }
      }
    }
  };

  const isCurrentLifecycle = (args: {
    lifecycleId: string;
    panelId: string;
    windowId?: string | undefined;
  }): boolean => {
    const current = currentLifecycleIds.get(
      panelKey(args.panelId, args.windowId)
    );
    return current === undefined
      ? args.lifecycleId === ""
      : current === args.lifecycleId;
  };

  const finish = async (args: FinishArgs): Promise<boolean> => {
    if (!isCurrentLifecycle(args)) {
      return false;
    }
    const key = lifecycleKey(args.panelId, args.lifecycleId, args.windowId);
    if (finishedPanels.has(key) || inFlightPanels.has(key)) {
      return false;
    }
    inFlightPanels.add(key);
    try {
      const stopRequested =
        deps.isStopRequested?.(args.panelId, args.windowId) ?? false;
      const exit: TerminalTaskExitStatus = {
        ...(args.code === undefined ? {} : { code: args.code }),
        reason: stopRequested ? "user" : args.reason,
        source: args.source,
      };
      const status = statusForExit(exit);

      // 进程完成是 TaskRun 的权威事实，不能受 terminal session 投影是否存在影响。
      // 停止请求只改变终态语义（cancelled），不改变完成事件的路由。
      if (args.reason === "process") {
        await deps.completePanel(
          args.panelId,
          normalizedCompletionCode(args.code),
          args.lifecycleId,
          args.windowId
        );
      } else {
        deps.markPanelClosed(args.panelId, args.windowId);
      }

      const sessionScope = deps.sessionScopeForBrowserWindow(
        args.browserWindowId
      );
      if (sessionScope) {
        const taskPatched = await deps.patchTaskStatus(
          sessionScope,
          args.panelId,
          args.lifecycleId,
          {
            ...(args.code === undefined ? {} : { exitCode: args.code }),
            exitReason: exit.reason,
            exitSource: args.source,
            finishedAt: deps.now(),
            status,
          }
        );
        if (taskPatched) {
          await deps.patchTab(
            sessionScope,
            args.panelId,
            taskExitTabPatch(exit)
          );
        }
      }
      finishedPanels.add(key);
      return true;
    } finally {
      inFlightPanels.delete(key);
    }
  };

  const recordExitCodeHint = (args: ExitCodeHintArgs): void => {
    if (!isCurrentLifecycle(args)) {
      return;
    }
    const key = lifecycleKey(args.panelId, args.lifecycleId, args.windowId);
    if (finishedPanels.has(key)) {
      return;
    }
    const existing = exitCodeHints.get(key);
    // 任务包装器写入的标题标记是 Pier 的权威退出码；
    // shell integration 可能滞后或只回报包装 shell，不能覆盖它。
    if (
      existing?.source === "task-exit-marker" &&
      args.source === "shell-command-finished"
    ) {
      return;
    }
    exitCodeHints.set(key, args);
  };

  return {
    recordExitCodeHint,
    async completeFromExitCodeHint(
      args: ImmediateExitCodeHintArgs
    ): Promise<boolean> {
      recordExitCodeHint(args);
      const completed = await finish({
        browserWindowId: args.browserWindowId,
        code: args.code,
        lifecycleId: args.lifecycleId,
        panelId: args.panelId,
        reason: "process",
        source: args.source,
        windowId: args.windowId,
      });
      if (completed) {
        exitCodeHints.delete(
          lifecycleKey(args.panelId, args.lifecycleId, args.windowId)
        );
      }
      return completed;
    },
    isCurrentLifecycle,
    resetPanel(
      panelId: string,
      lifecycleId: string,
      windowId?: string | undefined
    ): void {
      const panel = panelKey(panelId, windowId);
      clearPanelLifecycleState(panelId, windowId);
      currentLifecycleIds.set(panel, lifecycleId);
    },
    releasePanel(panelId: string, windowId?: string | undefined): void {
      clearPanelLifecycleState(panelId, windowId);
      currentLifecycleIds.delete(panelKey(panelId, windowId));
    },
    getCurrentLifecycleId(
      panelId: string,
      windowId?: string | undefined
    ): string | undefined {
      return currentLifecycleIds.get(panelKey(panelId, windowId));
    },
    moveOwner(input: {
      lifecycleId?: string | undefined;
      panelId: string;
      sourceWindowId: string;
      targetWindowId: string;
    }): void {
      const { panelId, sourceWindowId, targetWindowId } = input;
      const sourceKey = panelKey(panelId, sourceWindowId);
      const targetKey = panelKey(panelId, targetWindowId);
      const lifecycleId =
        input.lifecycleId ?? currentLifecycleIds.get(sourceKey) ?? "";
      // Move lifecycle bookkeeping to the target owner window.
      clearPanelLifecycleState(panelId, sourceWindowId);
      currentLifecycleIds.delete(sourceKey);
      clearPanelLifecycleState(panelId, targetWindowId);
      currentLifecycleIds.set(targetKey, lifecycleId);
    },
    /**
     * relaunch close 前置臂旗标, 由下一个 processAlive=true 的 native
     * process-close 消费。resetPanel 后旧 pane 事件会由 lifecycleId 守卫拒绝，
     * 因此可同时清理未被 native 消费的 dead-pty 标记，避免重复 relaunch 累积。
     */
    ignoreNextNativeUserClose(
      panelId: string,
      windowId?: string | undefined
    ): void {
      const lifecycleId =
        currentLifecycleIds.get(panelKey(panelId, windowId)) ?? "";
      ignoredNativeUserClosePanels.add(
        lifecycleKey(panelId, lifecycleId, windowId)
      );
    },
    async completeFromNativeProcessClose(
      args: NativeProcessCloseArgs
    ): Promise<boolean> {
      const key = lifecycleKey(args.panelId, args.lifecycleId, args.windowId);
      if (args.processAlive && ignoredNativeUserClosePanels.delete(key)) {
        return false;
      }
      if (!isCurrentLifecycle(args)) {
        return false;
      }
      const hint = exitCodeHints.get(key);
      exitCodeHints.delete(key);
      if (args.processAlive) {
        return await finish({
          browserWindowId: args.browserWindowId,
          lifecycleId: args.lifecycleId,
          panelId: args.panelId,
          reason: "user",
          source: "panel-close",
          windowId: args.windowId,
        });
      }
      return await finish({
        browserWindowId: args.browserWindowId,
        lifecycleId: args.lifecycleId,
        ...(hint ? { code: hint.code } : {}),
        panelId: args.panelId,
        reason: "process",
        source: "native-process-close",
        windowId: args.windowId,
      });
    },
  };
}
