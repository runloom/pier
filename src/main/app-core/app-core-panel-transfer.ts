import { app, dialog, screen } from "electron";
import { createPanelTransferService } from "../services/panel-transfer/panel-transfer-service.ts";
import type { PanelTransferService } from "../services/panel-transfer/panel-transfer-types.ts";
import type { RendererCommandService } from "../services/renderer-command-service.ts";
import {
  createWindowService,
  type WindowService,
} from "../services/window-service.ts";
import type { WorkspaceService } from "../services/workspace-service.ts";
import { windowManager } from "../windows/window-manager.ts";
import type { PluginDisableTransitionCoordinator } from "./plugin-disable-transition.ts";

export function wireAppCoreWindowAndPanelTransfer(input: {
  fileDraftsFlush: () => Promise<void>;
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

  panelTransferRef = createPanelTransferService({
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
