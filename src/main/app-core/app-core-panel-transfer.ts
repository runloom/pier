import { app, dialog, screen } from "electron";
import { foregroundActivityService } from "../ipc/foreground-activity.ts";
import { getTerminalAddon } from "../ipc/terminal.ts";
import { terminalFocusCoordinator } from "../ipc/terminal-focus-coordinator.ts";
import type { FileDraftsService } from "../services/file-drafts-types.ts";
import { createPanelTransferFilesPort } from "../services/panel-transfer/file-drafts-panel-transfer-port.ts";
import { createPanelTransferService } from "../services/panel-transfer/panel-transfer-service.ts";
import type { PanelTransferService } from "../services/panel-transfer/panel-transfer-types.ts";
import { createTerminalPanelTransfer } from "../services/panel-transfer/terminal-panel-transfer.ts";
import type { RendererCommandService } from "../services/renderer-command-service.ts";
import {
  createWindowService,
  type WindowService,
} from "../services/window-service.ts";
import type { WorkspaceService } from "../services/workspace-service.ts";
import { windowManager } from "../windows/window-manager.ts";
import type { PluginDisableTransitionCoordinator } from "./plugin-disable-transition.ts";
import { broadcastTaskRunsSnapshot } from "./window-broadcasts.ts";

export function wireAppCoreWindowAndPanelTransfer(input: {
  fileDrafts: FileDraftsService;
  fileDraftsFlush: () => Promise<void>;
  getTaskLifecycle?:
    | (() =>
        | import("../ipc/terminal-task-lifecycle-wiring.ts").RegisteredTerminalTaskLifecycle
        | null)
    | undefined;
  getTaskOutputBindings?:
    | (() =>
        | import("../ipc/terminal-task-output-bindings.ts").TaskOutputTerminalBindings
        | null)
    | undefined;
  getTaskService?:
    | (() =>
        | import("../services/tasks/task-service-types.ts").TaskService
        | null)
    | undefined;
  pluginDisableTransitions: PluginDisableTransitionCoordinator;
  rendererCommand: RendererCommandService;
  reportCloseFailureFallback: (args: {
    closeError: unknown;
    feedbackError: unknown;
    windowId: string;
  }) => Promise<void> | void;
  workspace: WorkspaceService;
}): {
  panelTransfer: PanelTransferService;
  window: WindowService;
} {
  let panelTransferRef: PanelTransferService | null = null;
  const windowService = createWindowService({
    finalizeRendererClose: async (windowId, transitionId, outcome) => {
      const result = await input.rendererCommand.execute({
        outcome,
        transitionId,
        type: "workspace.finalizeClose",
        windowId,
      });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    flushCriticalState: async () => {
      await input.fileDraftsFlush();
      await panelTransferRef?.flushJournal();
    },
    prepareRendererClose: async (windowId, reason, transitionId) => {
      const result = await input.rendererCommand.execute({
        reason,
        transitionId,
        type: "workspace.prepareClose",
        windowId,
      });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    reportCloseFailure: async (windowId, error) => {
      const result = await input.rendererCommand.execute({
        body: error instanceof Error ? error.message : String(error),
        type: "workspace.reportCloseFailure",
        windowId,
      });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    reportCloseFailureFallback: input.reportCloseFailureFallback,
    runWhenPluginTransitionsIdle: (operation) =>
      input.pluginDisableTransitions.runWindowCreation(operation),
    settlePanelTransferBeforeClose: (lease, windowId, reason) =>
      panelTransferRef?.settleWindowBeforeClose(lease, windowId, reason) ??
      Promise.resolve(),
    signalPanelTransferClosing: (windowId, reason) => {
      panelTransferRef?.signalWindowClosing(windowId, reason);
    },
  });

  const terminalTransfer = createTerminalPanelTransfer({
    broadcastTransfer: () => {
      // Dual-window task ownership refresh after move.
      // Snapshot is filtered per window inside the broadcaster.
      try {
        const tasks = input.getTaskService?.();
        if (tasks) {
          broadcastTaskRunsSnapshot(tasks.runsSnapshot());
        }
      } catch {
        // Best-effort; transfer commit must not fail on broadcast.
      }
    },
    focusCoordinator: terminalFocusCoordinator,
    foreground: {
      runSerial: (operation) => foregroundActivityService.runSerial(operation),
      transferScopes: (moveInput) => {
        foregroundActivityService.transferPanelOwnership(moveInput);
      },
    },
    getAddon: () => getTerminalAddon(),
    getTaskLifecycle: () => input.getTaskLifecycle?.() ?? null,
    getTaskOutputBindings: () => input.getTaskOutputBindings?.() ?? null,
    getTaskService: () => input.getTaskService?.() ?? null,
    resolveWindow: (runtimeWindowId) => {
      const win = windowManager.get(runtimeWindowId);
      if (!win || win.isDestroyed()) {
        return null;
      }
      const info = windowManager
        .list()
        .find((entry) => entry.id === runtimeWindowId);
      if (!info) {
        return null;
      }
      return { recordId: info.recordId, win };
    },
  });

  panelTransferRef = createPanelTransferService({
    files: createPanelTransferFilesPort(input.fileDrafts),
    terminal: terminalTransfer,
    geometry: {
      getCursorScreenPoint: () => screen.getCursorScreenPoint(),
      getDisplayWorkAreaNear: (point) =>
        screen.getDisplayNearestPoint(point).workArea,
      getWindowBounds: (windowId) => {
        const win = windowManager.get(windowId);
        if (!win || win.isDestroyed()) {
          return null;
        }
        const bounds = win.host.getBounds();
        return {
          height: bounds.height,
          width: bounds.width,
          x: bounds.x,
          y: bounds.y,
        };
      },
    },
    pluginMutation: (operation) =>
      input.pluginDisableTransitions.runPluginMutation(operation),
    rendererCommand: input.rendererCommand,
    reportJournalParseFailure: (journalPath, error) => {
      let detail = "unknown error";
      if (error instanceof Error) {
        detail = error.message;
      } else if (typeof error === "string") {
        detail = error;
      }
      const isChinese = app.getLocale().toLowerCase().startsWith("zh");
      dialog.showErrorBox(
        isChinese
          ? "面板迁移日志无法读取"
          : "Panel transfer journal unreadable",
        isChinese
          ? `路径：${journalPath}\n\n${detail}\n\n文件未被清除。请修复或备份后重启 Pier。`
          : `Path: ${journalPath}\n\n${detail}\n\nThe file was not wiped. Fix or back it up, then restart Pier.`
      );
    },
    userDataDir: app.getPath("userData"),
    windows: {
      closeAfterTransfer: (lease, windowId, transferId) =>
        windowService.closeAfterTransfer(lease, windowId, transferId),
      closeOpenWindowRecord: (recordId) =>
        windowService.closeOpenWindowRecord(recordId),
      createForTransfer: (lease, createInput) =>
        windowService.createForTransfer(lease, createInput),
      destroyForTransfer: (lease, windowId, transferId) =>
        windowService.destroyForTransfer(lease, windowId, transferId),
      holdRendererShow: (windowId, reason) => {
        windowManager.holdRendererShow(windowId, reason);
      },
      list: () => windowService.list(),
      releaseRendererShow: (windowId, reason) => {
        windowManager.releaseRendererShow(windowId, reason);
      },
      runExclusive: (operation) => windowService.runExclusive(operation),
    },
    workspace: {
      clearLayout: (recordId) => input.workspace.clearLayout(recordId),
      hasPanelId: async () => false,
    },
  });

  return {
    panelTransfer: panelTransferRef,
    window: windowService,
  };
}
