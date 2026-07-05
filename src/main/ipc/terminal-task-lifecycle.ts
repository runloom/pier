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
    windowId?: string | undefined
  ): Promise<unknown>;
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
  panelId: string;
  processAlive: boolean;
  windowId?: string | undefined;
}

interface FinishArgs {
  browserWindowId: number;
  code?: number | undefined;
  panelId: string;
  reason: TaskExitReason;
  source: TaskExitSource;
  windowId?: string | undefined;
}

function panelKey(panelId: string, windowId?: string | undefined): string {
  return windowId ? `${windowId}\0${panelId}` : panelId;
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
 * 不负责活动 broadcast：那走 `foregroundActivityService.taskFinished`
 * → `ForegroundActivityAggregator` 单源。
 */
export function createTerminalTaskLifecycle(deps: TerminalTaskLifecycleDeps) {
  const exitCodeHints = new Map<string, ExitCodeHintArgs>();
  const finishedPanels = new Set<string>();
  const ignoredNativeUserClosePanels = new Set<string>();

  const finish = async (args: FinishArgs): Promise<boolean> => {
    const key = panelKey(args.panelId, args.windowId);
    if (finishedPanels.has(key)) {
      return false;
    }

    const sessionScope = deps.sessionScopeForBrowserWindow(
      args.browserWindowId
    );
    if (!sessionScope) {
      return false;
    }
    finishedPanels.add(key);

    const exit: TerminalTaskExitStatus = {
      ...(args.code === undefined ? {} : { code: args.code }),
      reason: args.reason,
      source: args.source,
    };
    const status = statusForExit(exit);
    const taskPatched = await deps.patchTaskStatus(sessionScope, args.panelId, {
      ...(args.code === undefined ? {} : { exitCode: args.code }),
      exitReason: args.reason,
      exitSource: args.source,
      finishedAt: deps.now(),
      status,
    });

    if (!taskPatched) {
      finishedPanels.delete(key);
      return false;
    }

    if (args.reason === "process") {
      await deps.completePanel(
        args.panelId,
        normalizedCompletionCode(args.code),
        args.windowId
      );
    } else {
      deps.markPanelClosed(args.panelId, args.windowId);
    }

    const tab = taskExitTabPatch(exit);
    await deps.patchTab(sessionScope, args.panelId, tab);
    return true;
  };

  const recordExitCodeHint = (args: ExitCodeHintArgs): void => {
    const key = panelKey(args.panelId, args.windowId);
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
        panelId: args.panelId,
        reason: "process",
        source: args.source,
        windowId: args.windowId,
      });
      if (completed) {
        exitCodeHints.delete(panelKey(args.panelId, args.windowId));
      }
      return completed;
    },
    resetPanel(panelId: string, windowId?: string | undefined): void {
      const key = panelKey(panelId, windowId);
      exitCodeHints.delete(key);
      finishedPanels.delete(key);
    },
    /**
     * relaunch close 前置臂旗标, 由下一个 processAlive=true 的 native
     * process-close 消费。dead-pty relaunch 无 native echo（bridge close
     * 不发事件）, 旗标会悬挂——无害：alive=true 的消费场景都发生在面板
     * 真关闭/reconcile 之后, 被 skip 的 finish 产物彼时已随 session 移除
     * 失效；Set 按 panelKey 去重, 无泄漏增长。**勿在 resetPanel 里清它**：
     * create 之后迟到的旧 pane echo 会把新 run 误 finalize 成 cancelled。
     */
    ignoreNextNativeUserClose(
      panelId: string,
      windowId?: string | undefined
    ): void {
      ignoredNativeUserClosePanels.add(panelKey(panelId, windowId));
    },
    async completeFromNativeProcessClose(
      args: NativeProcessCloseArgs
    ): Promise<boolean> {
      const key = panelKey(args.panelId, args.windowId);
      const hint = exitCodeHints.get(key);
      exitCodeHints.delete(key);
      if (args.processAlive && ignoredNativeUserClosePanels.delete(key)) {
        return false;
      }
      if (args.processAlive) {
        return await finish({
          browserWindowId: args.browserWindowId,
          panelId: args.panelId,
          reason: "user",
          source: "panel-close",
          windowId: args.windowId,
        });
      }
      return await finish({
        browserWindowId: args.browserWindowId,
        ...(hint ? { code: hint.code } : {}),
        panelId: args.panelId,
        reason: "process",
        source: "native-process-close",
        windowId: args.windowId,
      });
    },
  };
}
