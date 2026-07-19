import { app, screen } from "electron";
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
      console.error(
        `[panel-transfer] journal unreadable at ${journalPath}:`,
        error
      );
    },
    userDataDir: app.getPath("userData"),
    windows: {
      closeAfterTransfer: (lease, windowId, transferId) =>
        windowService.closeAfterTransfer(lease, windowId, transferId),
      createForTransfer: (lease, createInput) =>
        windowService.createForTransfer(lease, createInput),
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
