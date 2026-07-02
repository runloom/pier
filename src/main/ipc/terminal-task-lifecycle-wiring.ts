import {
  patchTerminalPanelTab,
  patchTerminalPanelTaskStatus,
  updateTerminalPanelTitle,
} from "../state/terminal-session-state.ts";
import {
  findAppWindowByElectronId,
  findInternalWindowId,
} from "../windows/window-identity.ts";
import { agentSessionService } from "./agent-session.ts";
import { recordNativeTerminalRoute } from "./terminal-debug.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { terminalPanelClosed } from "./terminal-panel-closed.ts";
import { unscopePanelId } from "./terminal-panel-id.ts";
import { createTerminalTaskLifecycle } from "./terminal-task-lifecycle.ts";
import { terminalSessionScopeFor } from "./terminal-window-scope.ts";

export interface RegisteredTerminalTaskLifecycle {
  ignoreNextNativeUserClose(
    panelId: string,
    windowId?: string | undefined
  ): void;
  resetPanel(panelId: string, windowId?: string | undefined): void;
}

export function registerTerminalTaskLifecycleForwarding(
  addon: NativeAddon | null
): RegisteredTerminalTaskLifecycle {
  const lifecycle = createTerminalTaskLifecycle({
    completePanel: (panelId, exitCode, windowId) => {
      terminalPanelClosed.notifyTerminalPanelExit(panelId, exitCode, windowId);
      return Promise.resolve(null);
    },
    forwardTabPatch: (browserWindowId, panelId, tab) => {
      forwardToWindow(
        browserWindowId,
        "pier:terminal:tab-chrome-patch",
        { panelId, tab },
        "pier-task-tab-patch"
      );
    },
    markPanelClosed: (panelId, windowId) => {
      terminalPanelClosed.notifyTerminalPanelClosed(panelId, windowId);
    },
    now: () => Date.now(),
    patchTab: patchTerminalPanelTab,
    patchTaskStatus: patchTerminalPanelTaskStatus,
    sessionScopeForBrowserWindow: (browserWindowId) => {
      const win = findAppWindowByElectronId(browserWindowId);
      return win && !win.isDestroyed() ? terminalSessionScopeFor(win) : null;
    },
  });

  addon?.setCommandFinishedForwardCallback?.((id, panelId, exitCode) => {
    const normalizedExitCode = exitCode < 0 ? 1 : exitCode;
    recordNativeTerminalRoute(id, "command-finished", panelId, {
      exitCode: normalizedExitCode,
    });
    const rawPanelId = unscopePanelId(panelId);
    // 前台命令退出 = 该面板运行中的 agent CLI 已退出（若有会话）——清理并还原
    // tab/状态栏呈现。覆盖崩溃/kill 等无 SessionEnd hook 的路径。
    // 透传原始 exitCode：悬挂家族(145-148, Ctrl+Z)不视为 agent 退出。
    agentSessionService.commandFinished(String(id), rawPanelId, exitCode);
    const targetWindow = findAppWindowByElectronId(id);
    if (exitCode >= 0) {
      lifecycle
        .completeFromExitCodeHint({
          browserWindowId: id,
          code: exitCode,
          panelId: rawPanelId,
          source: "shell-command-finished",
          ...(targetWindow
            ? { windowId: findInternalWindowId(targetWindow) ?? undefined }
            : {}),
        })
        .catch((err) => {
          console.error("[pier-task-lifecycle:command-finished] failed:", err);
        });
      return;
    }
    lifecycle.recordExitCodeHint({
      browserWindowId: id,
      code: normalizedExitCode,
      panelId: rawPanelId,
      source: "shell-command-finished",
      ...(targetWindow
        ? { windowId: findInternalWindowId(targetWindow) ?? undefined }
        : {}),
    });
  });

  addon?.setProcessClosedForwardCallback?.((id, panelId, processAlive) => {
    recordNativeTerminalRoute(id, "process-closed", panelId, {
      processAlive,
    });
    const rawPanelId = unscopePanelId(panelId);
    const targetWindow = findAppWindowByElectronId(id);
    agentSessionService.panelClosed(String(id), rawPanelId);
    lifecycle
      .completeFromNativeProcessClose({
        browserWindowId: id,
        panelId: rawPanelId,
        processAlive,
        ...(targetWindow
          ? { windowId: findInternalWindowId(targetWindow) ?? undefined }
          : {}),
      })
      .catch((err) => {
        console.error("[pier-task-lifecycle:process-closed] failed:", err);
      });
  });

  addon?.setTitleForwardCallback((id, panelId, title) => {
    recordNativeTerminalRoute(id, "title", panelId, { title });
    const rawPanelId = unscopePanelId(panelId);
    const targetWindow = findAppWindowByElectronId(id);
    const taskExitCode = terminalPanelClosed.parseTaskExitTitle(title);
    if (taskExitCode !== null) {
      lifecycle
        .completeFromExitCodeHint({
          browserWindowId: id,
          code: taskExitCode,
          panelId: rawPanelId,
          source: "task-exit-marker",
          ...(targetWindow
            ? { windowId: findInternalWindowId(targetWindow) ?? undefined }
            : {}),
        })
        .catch((err) => {
          console.error("[pier-task-lifecycle:title-exit] failed:", err);
        });
      return;
    }

    agentSessionService.ingestTitle(String(id), rawPanelId, title);

    if (targetWindow && !targetWindow.isDestroyed()) {
      const sessionScope = terminalSessionScopeFor(targetWindow);
      updateTerminalPanelTitle(sessionScope, rawPanelId, title).catch((err) => {
        console.error("[pier-title-persist] failed:", err);
      });
    }
    forwardToWindow(
      id,
      "pier:terminal:title-change",
      { panelId: rawPanelId, title },
      "pier-title-forward"
    );
  });

  return lifecycle;
}
