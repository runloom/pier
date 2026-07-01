import type {
  TaskExitReason,
  TaskExitSource,
  TaskPanelStatus,
} from "@shared/contracts/tasks.ts";
import type { TerminalTabChromePatchEvent } from "@shared/contracts/terminal.ts";
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
  forwardTabPatch(
    browserWindowId: number,
    panelId: string,
    tab: TerminalTabChromePatchEvent["tab"]
  ): void;
  markPanelClosed(panelId: string, windowId?: string | undefined): void;
  now(): number;
  patchTab(
    sessionScope: string,
    panelId: string,
    tab: TerminalTabChromePatchEvent["tab"]
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
    deps.forwardTabPatch(args.browserWindowId, args.panelId, tab);
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
