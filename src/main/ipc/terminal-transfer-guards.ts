/** Transfer-lease-aware terminal close/reconcile helpers and addon accessors. */

import type { TerminalCloseOptions } from "@shared/contracts/terminal.ts";
import type { IpcMain, WebContents } from "electron";
import { getTerminalPanelTransfer } from "../services/panel-transfer/terminal-panel-transfer.ts";
import type { TaskService } from "../services/tasks/task-service.ts";
import {
  removeTerminalPanelSession,
  retainTerminalPanelSessions,
} from "../state/terminal-session-state.ts";
import type { AppWindow } from "../windows/app-window.ts";
import { findInternalWindowId } from "../windows/window-identity.ts";
import { foregroundActivityService } from "./foreground-activity.ts";
import { recordRendererTerminalRoute } from "./terminal-debug.ts";
import { terminalFocusCoordinator } from "./terminal-focus-coordinator.ts";
import { cancelPromptReady } from "./terminal-initial-input-gate.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { toNativePanelKey } from "./terminal-panel-id.ts";
import type { RegisteredTerminalTaskLifecycle } from "./terminal-task-lifecycle-wiring.ts";
import type { TaskOutputTerminalBindings } from "./terminal-task-output-bindings.ts";
import { windowRecordIdFor } from "./terminal-window-scope.ts";

let cachedAddon: NativeAddon | null = null;
let boundTaskLifecycle: RegisteredTerminalTaskLifecycle | null = null;
let boundTaskOutputBindings: TaskOutputTerminalBindings | null = null;
let boundTaskService: TaskService | null = null;

export const getTerminalAddon = (): NativeAddon | null => cachedAddon;

export function getTerminalTaskLifecycleForTransfer() {
  return boundTaskLifecycle;
}
export function getTerminalTaskOutputBindingsForTransfer() {
  return boundTaskOutputBindings;
}
export function getTerminalTaskServiceForTransfer() {
  return boundTaskService;
}

export function bindTerminalTransferRuntime(input: {
  addon: NativeAddon | null;
  taskLifecycle: RegisteredTerminalTaskLifecycle | null;
  taskOutputBindings: TaskOutputTerminalBindings | null;
  taskService: TaskService | null;
}): void {
  cachedAddon = input.addon;
  boundTaskLifecycle = input.taskLifecycle;
  boundTaskOutputBindings = input.taskOutputBindings;
  boundTaskService = input.taskService;
}

/** Mid-transfer / post-move source close: succeed without killing the surface. */
export function tryAcknowledgeTransferSourceClose(input: {
  panelId: string;
  win: AppWindow;
  windowId: string | undefined;
}): boolean {
  const transfer = getTerminalPanelTransfer();
  if (
    !(
      input.windowId &&
      transfer?.acknowledgeSourceCloseIdempotent(input.windowId, input.panelId)
    )
  ) {
    return false;
  }
  terminalFocusCoordinator.surfaceWillClose(input.win, input.panelId);
  cancelPromptReady(input.panelId);
  return true;
}

export function planTransferAwareReconcile(input: {
  activeIds: readonly string[];
  win: AppWindow;
}): {
  isLeasedPanel: (panelId: string) => boolean;
  isNativeKeyLeased: (nativePanelId: string) => boolean;
  retainActiveIds: readonly string[];
  runtimeWindowId: string | undefined;
  transfer: ReturnType<typeof getTerminalPanelTransfer>;
} {
  const transfer = getTerminalPanelTransfer();
  const runtimeWindowId = findInternalWindowId(input.win) ?? undefined;
  const isLeasedPanel = (panelId: string): boolean =>
    Boolean(
      runtimeWindowId && transfer?.isPanelLeased(runtimeWindowId, panelId)
    );
  const retainActiveIds =
    runtimeWindowId && transfer
      ? transfer.retainedPanelIdsForWindow(runtimeWindowId, input.activeIds)
      : input.activeIds;
  return {
    isLeasedPanel,
    isNativeKeyLeased: (nativePanelId) =>
      transfer?.isNativeKeyLeased(nativePanelId) === true,
    retainActiveIds,
    runtimeWindowId,
    transfer,
  };
}

export function registerTerminalTransferGuardIpc(opts: {
  addon: NativeAddon | null;
  ipcMain: IpcMain;
  taskLifecycle: RegisteredTerminalTaskLifecycle;
  taskOutputBindings: TaskOutputTerminalBindings | null;
  taskService?: TaskService | undefined;
  windowFromWebContents: (webContents: WebContents) => AppWindow | null;
}): void {
  const {
    addon,
    ipcMain,
    taskLifecycle,
    taskOutputBindings,
    taskService,
    windowFromWebContents,
  } = opts;

  ipcMain.handle(
    "pier:terminal:close",
    async (
      event,
      panelId: string,
      options?: TerminalCloseOptions | undefined
    ) => {
      const win = windowFromWebContents(event.sender);
      if (!win) {
        return;
      }
      const windowId = findInternalWindowId(win) ?? undefined;
      const sessionScope = windowRecordIdFor(win);
      recordRendererTerminalRoute(win, "close", panelId);
      if (options?.reason === "relaunch") {
        // relaunch = 同 panel 换 pty, 不是面板死亡。TaskRuns 仍持有 panel
        // 映射，RuntimeControl / tab overlay 不依赖 FA task slot。
        taskLifecycle.ignoreNextNativeUserClose(panelId, windowId);
      } else {
        foregroundActivityService.panelClosed(panelId, String(win.id));
        taskService?.markPanelClosed(panelId, windowId);
        taskLifecycle.releasePanel(panelId, windowId);
      }
      if (tryAcknowledgeTransferSourceClose({ panelId, win, windowId })) {
        return;
      }
      const nativePanelId = toNativePanelKey(win, panelId);
      taskOutputBindings?.detach(nativePanelId);
      terminalFocusCoordinator.surfaceWillClose(win, panelId);
      // 面板关闭时清 initial-input gate 的 pending 定时器，防止 pty 已死
      // 但 fallback timer 仍尝试注入到不存在的 panel。
      cancelPromptReady(panelId);
      addon?.closeTerminal(nativePanelId);
      try {
        await removeTerminalPanelSession(sessionScope, panelId);
      } catch (err) {
        console.error("[pier-cwd-remove] failed:", err);
      }
    }
  );

  ipcMain.on("pier:terminal:reconcile", (event, activeIds: string[]) => {
    if (!addon) {
      return;
    }
    const win = windowFromWebContents(event.sender);
    if (!win) {
      return;
    }
    recordRendererTerminalRoute(win, "reconcile", null, {
      count: activeIds.length,
    });
    const { isLeasedPanel, isNativeKeyLeased, retainActiveIds } =
      planTransferAwareReconcile({ activeIds, win });
    foregroundActivityService.retainPanels(String(win.id), retainActiveIds);
    // 仅在有明确 active 集合时 GC session。空数组常见于 layout 应用前/中，
    // 此时删 running+resume 会毁掉可恢复会话；单 panel 关闭已走 removeSession。
    if (activeIds.length > 0) {
      retainTerminalPanelSessions(windowRecordIdFor(win), retainActiveIds, {
        isLeased: isLeasedPanel,
      }).catch((err) => {
        console.error("[pier-terminal-session-gc] failed:", err);
      });
    }
    try {
      const reconcileNativeIds = retainActiveIds.map((id) =>
        toNativePanelKey(win, id)
      );
      taskOutputBindings?.retainWindow(win.id, reconcileNativeIds, {
        isLeased: isNativeKeyLeased,
      });
      addon.reconcileTerminals(win.getNativeWindowHandle(), reconcileNativeIds);
    } catch (err) {
      console.error("[pier-terminal-reconcile] failed:", err);
    }
  });
}
