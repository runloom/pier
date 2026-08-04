/**
 * Intentional (non-drag) panel relocate: offer + relocate claim for menu /
 * command-palette paths (move/copy into new or other windows).
 */

import {
  isPanelTransferCopyableComponent,
  type PanelTransferMode,
  type PanelTransferPlacement,
  type PanelTransferRelocateTarget,
  type PanelTransferResult,
} from "@shared/contracts/panel-transfer.ts";
import i18next from "i18next";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { isPanelTransferMovable } from "./adapters.ts";
import { pickOtherWindowId } from "./pick-window.ts";
import {
  type DockviewPanel,
  panelComponentOf,
  panelJsonParamsOf,
  panelTitleOf,
  pierPanelTransfer,
  showPanelTransferFailure,
} from "./shared.ts";

function findPanel(panelId: string): DockviewPanel | null {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    return null;
  }
  return api.panels.find((panel) => panel.id === panelId) ?? null;
}

export function resolveRelocatePanelId(sourcePanelId?: string): string | null {
  return (
    sourcePanelId ?? useWorkspaceStore.getState().api?.activePanel?.id ?? null
  );
}

export function canMovePanelToWindow(panelId: string): boolean {
  const panel = findPanel(panelId);
  if (!panel) {
    return false;
  }
  const component = panelComponentOf(panel);
  return component != null && isPanelTransferMovable(component);
}

export function canCopyPanelToWindow(panelId: string): boolean {
  const panel = findPanel(panelId);
  if (!panel) {
    return false;
  }
  const component = panelComponentOf(panel);
  return (
    component != null &&
    isPanelTransferMovable(component) &&
    isPanelTransferCopyableComponent(component)
  );
}

export async function relocatePanel(input: {
  mode?: PanelTransferMode;
  panelId: string;
  placement?: PanelTransferPlacement;
  target: PanelTransferRelocateTarget;
}): Promise<PanelTransferResult> {
  const panel = findPanel(input.panelId);
  if (!panel) {
    return {
      code: "source_unavailable",
      message: "panel not found",
      ok: false,
    };
  }
  const component = panelComponentOf(panel);
  if (!(component && isPanelTransferMovable(component))) {
    return {
      code: "not_supported",
      message: "panel transfer not supported",
      ok: false,
    };
  }

  const mode = input.mode ?? "move";
  if (mode === "copy" && !isPanelTransferCopyableComponent(component)) {
    return {
      code: "not_supported",
      message: "panel copy not supported",
      ok: false,
    };
  }

  const transferId = crypto.randomUUID();
  const offerResult = await pierPanelTransfer().offer({
    capability: "movable",
    mode,
    panel: {
      componentId: component,
      panelId: panel.id,
      params: panelJsonParamsOf(panel),
      title: panelTitleOf(panel),
    },
    transferId,
    version: 1,
  });
  if (!offerResult.accepted) {
    return {
      code: "not_supported",
      message: "panel transfer not accepted",
      ok: false,
    };
  }

  return await pierPanelTransfer().relocate({
    transferId,
    target: input.target,
    ...(input.placement ? { placement: input.placement } : {}),
  });
}

async function runRelocateWithUi(input: {
  failureTitleKey: string;
  mode: PanelTransferMode;
  panelId: string;
  target: PanelTransferRelocateTarget;
}): Promise<void> {
  try {
    const result = await relocatePanel({
      mode: input.mode,
      panelId: input.panelId,
      target: input.target,
    });
    if (result.ok) {
      return;
    }
    await showPanelTransferFailure(result, {
      titleKey: input.failureTitleKey,
    });
  } catch (error) {
    await showAppAlert({
      body: error instanceof Error ? error.message : String(error),
      title: i18next.t(input.failureTitleKey),
    });
  }
}

export async function movePanelToNewWindow(panelId: string): Promise<void> {
  await runRelocateWithUi({
    failureTitleKey: "workspace.panelTransfer.moveToNewWindowFailed",
    mode: "move",
    panelId,
    target: { kind: "new-window" },
  });
}

export async function copyPanelToNewWindow(panelId: string): Promise<void> {
  await runRelocateWithUi({
    failureTitleKey: "workspace.panelTransfer.copyToNewWindowFailed",
    mode: "copy",
    panelId,
    target: { kind: "new-window" },
  });
}

export async function movePanelToOtherWindow(panelId: string): Promise<void> {
  const windowId = await pickOtherWindowId();
  if (!windowId) {
    return;
  }
  await runRelocateWithUi({
    failureTitleKey: "workspace.panelTransfer.moveToWindowFailed",
    mode: "move",
    panelId,
    target: { kind: "window", windowId },
  });
}

export async function copyPanelToOtherWindow(panelId: string): Promise<void> {
  const windowId = await pickOtherWindowId();
  if (!windowId) {
    return;
  }
  await runRelocateWithUi({
    failureTitleKey: "workspace.panelTransfer.copyToWindowFailed",
    mode: "copy",
    panelId,
    target: { kind: "window", windowId },
  });
}
