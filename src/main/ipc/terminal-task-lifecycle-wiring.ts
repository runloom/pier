import { matchAgentCommand } from "@shared/agent-command-detection.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import {
  patchTerminalPanelAgentStatus,
  patchTerminalPanelTab,
  patchTerminalPanelTaskStatus,
  updateTerminalPanelTitle,
} from "../state/terminal-session-state.ts";
import {
  findAppWindowByElectronId,
  findInternalWindowId,
} from "../windows/window-identity.ts";
import { foregroundActivityService } from "./foreground-activity.ts";
import { recordNativeTerminalRoute } from "./terminal-debug.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { fromNativePanelKey } from "./terminal-panel-id.ts";
import { parseTaskExitTitle } from "./terminal-task-exit-title.ts";
import { createTerminalTaskLifecycle } from "./terminal-task-lifecycle.ts";
import { windowRecordIdFor } from "./terminal-window-scope.ts";

export interface RegisteredTerminalTaskLifecycle {
  ignoreNextNativeUserClose(
    panelId: string,
    windowId?: string | undefined
  ): void;
  releasePanel(panelId: string, windowId?: string | undefined): void;
  resetPanel(
    panelId: string,
    lifecycleId: string,
    windowId?: string | undefined
  ): void;
}

export function registerTerminalTaskLifecycleForwarding(
  addon: NativeAddon | null,
  options: {
    completeTaskPanel?:
      | ((
          panelId: string,
          exitCode: number,
          lifecycleId: string,
          windowId?: string | undefined
        ) => Promise<unknown>)
      | undefined;
    isTaskStopRequested?:
      | ((panelId: string, windowId?: string | undefined) => boolean)
      | undefined;
    markTaskPanelClosed?:
      | ((panelId: string, windowId?: string | undefined) => void)
      | undefined;
  } = {}
): RegisteredTerminalTaskLifecycle {
  const lifecycle = createTerminalTaskLifecycle({
    completePanel: (panelId, exitCode, lifecycleId, windowId) =>
      options.completeTaskPanel?.(panelId, exitCode, lifecycleId, windowId) ??
      Promise.resolve(null),
    markPanelClosed: (panelId, windowId) =>
      options.markTaskPanelClosed?.(panelId, windowId),
    isStopRequested: (panelId, windowId) =>
      options.isTaskStopRequested?.(panelId, windowId) ?? false,
    now: () => Date.now(),
    patchTab: patchTerminalPanelTab,
    patchTaskStatus: patchTerminalPanelTaskStatus,
    sessionScopeForBrowserWindow: (browserWindowId) => {
      const win = findAppWindowByElectronId(browserWindowId);
      return win && !win.isDestroyed() ? windowRecordIdFor(win) : null;
    },
  });

  addon?.setCommandFinishedForwardCallback?.(
    (id, panelId, lifecycleId, exitCode) => {
      const normalizedExitCode = exitCode < 0 ? 1 : exitCode;
      recordNativeTerminalRoute(id, "command-finished", panelId, {
        exitCode: normalizedExitCode,
      });
      const rawPanelId = fromNativePanelKey(panelId);
      const targetWindow = findAppWindowByElectronId(id);
      const windowId = targetWindow
        ? (findInternalWindowId(targetWindow) ?? undefined)
        : undefined;
      if (
        !lifecycle.isCurrentLifecycle({
          lifecycleId,
          panelId: rawPanelId,
          windowId,
        })
      ) {
        return;
      }
      // 前台命令退出 = 该面板运行中的 agent CLI 已退出（若有会话）——清理并还原
      // tab/状态栏呈现。覆盖崩溃/kill 等无 SessionEnd hook 的路径。
      // 透传原始 exitCode：悬挂家族(145-148, Ctrl+Z)不视为 agent 退出。
      if (!lifecycleId) {
        foregroundActivityService.commandFinished(
          rawPanelId,
          exitCode,
          String(id)
        );
      }
      if (
        !lifecycleId &&
        targetWindow &&
        !targetWindow.isDestroyed() &&
        exitCode >= 0
      ) {
        patchTerminalPanelAgentStatus(
          windowRecordIdFor(targetWindow),
          rawPanelId,
          {
            exitCode,
            finishedAt: Date.now(),
            status: "exited",
          }
        ).catch((err) => {
          console.error("[pier-agent-session:command-finished] failed:", err);
        });
      }
      if (exitCode >= 0) {
        lifecycle
          .completeFromExitCodeHint({
            browserWindowId: id,
            code: exitCode,
            lifecycleId,
            panelId: rawPanelId,
            source: "shell-command-finished",
            ...(targetWindow ? { windowId } : {}),
          })
          .catch((err) => {
            console.error(
              "[pier-task-lifecycle:command-finished] failed:",
              err
            );
          });
        return;
      }
      lifecycle.recordExitCodeHint({
        browserWindowId: id,
        code: normalizedExitCode,
        lifecycleId,
        panelId: rawPanelId,
        source: "shell-command-finished",
        ...(targetWindow ? { windowId } : {}),
      });
    }
  );

  addon?.setCommandStartedForwardCallback?.(
    (id, panelId, lifecycleId, commandLine) => {
      recordNativeTerminalRoute(id, "command-started", panelId, {
        commandLine,
      });
      const rawPanelId = fromNativePanelKey(panelId);
      const targetWindow = findAppWindowByElectronId(id);
      if (!targetWindow || targetWindow.isDestroyed()) {
        return;
      }
      const windowId = findInternalWindowId(targetWindow) ?? undefined;
      if (
        lifecycleId ||
        !lifecycle.isCurrentLifecycle({
          lifecycleId,
          panelId: rawPanelId,
          windowId,
        })
      ) {
        return;
      }
      // ghostty OSC 133 C 命令行文本 → matchAgentCommand 词元识别 → 先验点亮
      // agent entry。hook 生效前就有 icon 状态，等价 loomdesk 的 L1 shell
      // integration commandLine 检测。
      //
      // windowId 用 electron BrowserWindow.id 字符串（不是内部 UUID）——聚合器
      // 广播时对 session.windowId 做 Number()，然后交给 forwardToWindow；UUID
      // 会变 NaN。HTTP `PIER_WINDOW_ID = String(win.id)` 已经是同一约定。
      const agentId = matchAgentCommand(commandLine);
      // unified aggregator: null → shell activity, 非空 → agentLaunched 路径。
      foregroundActivityService.ingestCommandStarted(
        rawPanelId,
        String(id),
        commandLine,
        agentId
      );
    }
  );

  addon?.setProcessClosedForwardCallback?.(
    (id, panelId, lifecycleId, processAlive) => {
      recordNativeTerminalRoute(id, "process-closed", panelId, {
        processAlive,
      });
      const rawPanelId = fromNativePanelKey(panelId);
      const targetWindow = findAppWindowByElectronId(id);
      const windowId = targetWindow
        ? (findInternalWindowId(targetWindow) ?? undefined)
        : undefined;
      if (
        !lifecycle.isCurrentLifecycle({
          lifecycleId,
          panelId: rawPanelId,
          windowId,
        })
      ) {
        return;
      }
      // pty 进程退出 ≠ 面板关闭：task 面板保留终态 activity（tab 退出
      // chrome 单源）, 其余面板照旧清理。真正的面板关闭走 pier:terminal:close。
      foregroundActivityService.ptyExited(rawPanelId, String(id));
      if (
        !lifecycleId &&
        targetWindow &&
        !targetWindow.isDestroyed() &&
        processAlive === false
      ) {
        patchTerminalPanelAgentStatus(
          windowRecordIdFor(targetWindow),
          rawPanelId,
          {
            finishedAt: Date.now(),
            status: "exited",
          }
        ).catch((err) => {
          console.error("[pier-agent-session:process-closed] failed:", err);
        });
      }
      // Ghostty 在底层进程退出后保留 surface，显示
      // "Press any key to close the terminal"。用户按键后才会走到
      // close-surface callback，此时由 renderer 的 workspace 关闭策略收口。
      // processAlive=true 是宿主主动关闭 native surface 的回声，
      // 不得再次请求关闭 panel，否则会形成递归。
      if (processAlive === false) {
        forwardToWindow(
          id,
          PIER_BROADCAST.TERMINAL_SURFACE_CLOSE_REQUEST,
          { panelId: rawPanelId },
          "pier-terminal-surface-close"
        );
      }
      lifecycle
        .completeFromNativeProcessClose({
          browserWindowId: id,
          lifecycleId,
          panelId: rawPanelId,
          processAlive,
          ...(targetWindow ? { windowId } : {}),
        })
        .catch((err) => {
          console.error("[pier-task-lifecycle:process-closed] failed:", err);
        });
    }
  );

  addon?.setTitleForwardCallback((id, panelId, lifecycleId, title) => {
    recordNativeTerminalRoute(id, "title", panelId, { title });
    const rawPanelId = fromNativePanelKey(panelId);
    const targetWindow = findAppWindowByElectronId(id);
    const windowId = targetWindow
      ? (findInternalWindowId(targetWindow) ?? undefined)
      : undefined;
    if (
      !lifecycle.isCurrentLifecycle({
        lifecycleId,
        panelId: rawPanelId,
        windowId,
      })
    ) {
      return;
    }
    const taskExitCode = parseTaskExitTitle(title);
    if (taskExitCode !== null) {
      lifecycle
        .completeFromExitCodeHint({
          browserWindowId: id,
          code: taskExitCode,
          lifecycleId,
          panelId: rawPanelId,
          source: "task-exit-marker",
          ...(targetWindow ? { windowId } : {}),
        })
        .catch((err) => {
          console.error("[pier-task-lifecycle:title-exit] failed:", err);
        });
      return;
    }
    if (targetWindow && !targetWindow.isDestroyed()) {
      const sessionScope = windowRecordIdFor(targetWindow);
      updateTerminalPanelTitle(sessionScope, rawPanelId, title).catch((err) => {
        console.error("[pier-title-persist] failed:", err);
      });
    }
    forwardToWindow(
      id,
      PIER_BROADCAST.TERMINAL_TITLE_CHANGED,
      { panelId: rawPanelId, title },
      "pier-title-forward"
    );
  });

  return lifecycle;
}
