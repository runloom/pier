import { matchAgentCommand } from "@shared/agent-command-detection.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import {
  patchTerminalPanelTab,
  patchTerminalPanelTaskStatus,
  updateTerminalPanelTitle,
} from "../state/terminal-session-state.ts";
import {
  findAppWindowByElectronId,
  findInternalWindowId,
} from "../windows/window-identity.ts";
import {
  agentSessionService,
  foregroundActivityService,
} from "./agent-session.ts";
import { recordNativeTerminalRoute } from "./terminal-debug.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { terminalPanelClosed } from "./terminal-panel-closed.ts";
import { fromNativePanelKey } from "./terminal-panel-id.ts";
import { createTerminalTaskLifecycle } from "./terminal-task-lifecycle.ts";
import { windowRecordIdFor } from "./terminal-window-scope.ts";

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
        PIER_BROADCAST.TERMINAL_TAB_CHROME_PATCHED,
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
      return win && !win.isDestroyed() ? windowRecordIdFor(win) : null;
    },
  });

  addon?.setCommandFinishedForwardCallback?.((id, panelId, exitCode) => {
    const normalizedExitCode = exitCode < 0 ? 1 : exitCode;
    recordNativeTerminalRoute(id, "command-finished", panelId, {
      exitCode: normalizedExitCode,
    });
    const rawPanelId = fromNativePanelKey(panelId);
    // 前台命令退出 = 该面板运行中的 agent CLI 已退出（若有会话）——清理并还原
    // tab/状态栏呈现。覆盖崩溃/kill 等无 SessionEnd hook 的路径。
    // 透传原始 exitCode：悬挂家族(145-148, Ctrl+Z)不视为 agent 退出。
    agentSessionService.commandFinished(rawPanelId, exitCode);
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

  addon?.setCommandStartedForwardCallback?.((id, panelId, commandLine) => {
    recordNativeTerminalRoute(id, "command-started", panelId, { commandLine });
    const rawPanelId = fromNativePanelKey(panelId);
    const targetWindow = findAppWindowByElectronId(id);
    if (!targetWindow || targetWindow.isDestroyed()) {
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
    if (agentId) {
      agentSessionService.agentLaunched(String(id), rawPanelId, agentId);
    }
    // 双写 foregroundActivity：null → shell activity, 非空 → 通过 agentLaunched。
    foregroundActivityService.ingestCommandStarted(
      rawPanelId,
      String(id),
      commandLine,
      agentId
    );
  });

  addon?.setProcessClosedForwardCallback?.((id, panelId, processAlive) => {
    recordNativeTerminalRoute(id, "process-closed", panelId, {
      processAlive,
    });
    const rawPanelId = fromNativePanelKey(panelId);
    const targetWindow = findAppWindowByElectronId(id);
    agentSessionService.panelClosed(rawPanelId);
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
    const rawPanelId = fromNativePanelKey(panelId);
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
