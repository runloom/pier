/**
 * Apply main-broadcast drop preview in this renderer.
 *
 * Source window: Dockview's HTML5 overlay owns UX. A dockview-core patch
 * clears the absolute-mounted sticky overlay when the pointer leaves this
 * document (`dragleave` relatedTarget outside documentElement) or the HTML5
 * drag ends (`dragend`). The source tab is visually torn off (`tear-off.ts`)
 * so dragend cannot snap it back. This session owns overlay lifetime by
 * `transferId`: `end(id)` seals that id so a late Path B tick cannot
 * re-arm it, and `clear` for A cannot tear down live B.
 *
 * Target window: HTML5 dragover never arrives across WebContentsView, so
 * we drive Dockview's own `contentDropTarget.showOverlay` (the keyboard-
 * docking path) from the broadcast client point. Terminal NSViews still
 * need a fullscreen web overlay so they do not cover it.
 */

import type { PanelTransferOverlayPreview } from "@shared/contracts/panel-transfer.ts";
import { panelTransferOverlayPreviewSchema } from "@shared/contracts/panel-transfer.ts";
import type { DockviewApi } from "dockview-react";
import { registerTerminalFullscreenWebOverlay } from "@/stores/terminal-input-routing-slice.ts";
import { getActiveDrag } from "./dnd.ts";
import { resolvePlacementFromClientPoint } from "./placement.ts";
import {
  hidePanelTransferTearOff,
  revealPanelTransferTearOff,
} from "./tear-off.ts";

const WEB_OVERLAY_ID = "panel-transfer-drop-preview";

type OverlayPosition = "bottom" | "center" | "left" | "right" | "top";

interface ContentDropTargetLike {
  clearOverlay: () => void;
  showOverlay: (position: OverlayPosition) => void;
}

let webOverlayDispose: (() => void) | null = null;
let lastShownKey: string | null = null;

function ensureWebOverlay(): void {
  if (webOverlayDispose) {
    return;
  }
  const registration = registerTerminalFullscreenWebOverlay(WEB_OVERLAY_ID);
  webOverlayDispose = () => {
    registration.dispose();
  };
}

function releaseWebOverlay(): void {
  webOverlayDispose?.();
  webOverlayDispose = null;
}

function dropTargetOf(group: unknown): ContentDropTargetLike | null {
  if (!group || typeof group !== "object") {
    return null;
  }
  const target = (group as { model?: { contentDropTarget?: unknown } }).model
    ?.contentDropTarget;
  if (!target || typeof target !== "object") {
    return null;
  }
  const candidate = target as ContentDropTargetLike;
  if (
    typeof candidate.showOverlay !== "function" ||
    typeof candidate.clearOverlay !== "function"
  ) {
    return null;
  }
  return candidate;
}

function groupIdOf(group: unknown): string | null {
  if (!group || typeof group !== "object") {
    return null;
  }
  const id = (group as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

export function clearDockviewDropOverlays(api: DockviewApi): void {
  lastShownKey = null;
  for (const group of api.groups ?? []) {
    dropTargetOf(group)?.clearOverlay();
  }
}

function directionToOverlay(
  direction: "above" | "below" | "left" | "right"
): OverlayPosition {
  if (direction === "above") {
    return "top";
  }
  if (direction === "below") {
    return "bottom";
  }
  return direction;
}

/**
 * Show Dockview's native drop overlay at the Path B client point.
 * Returns whether an overlay was shown.
 */
export function showDockviewDropOverlayAt(
  api: DockviewApi,
  clientX: number,
  clientY: number
): boolean {
  const placement = resolvePlacementFromClientPoint(api, clientX, clientY);
  let targetGroupId: string | null = null;
  let position: OverlayPosition | null = null;
  if (placement.kind === "split" && placement.referenceGroupId) {
    targetGroupId = placement.referenceGroupId;
    position = directionToOverlay(placement.direction);
  } else if (placement.kind === "tab") {
    targetGroupId = placement.groupId;
    position = "center";
  }
  if (!(targetGroupId && position)) {
    clearDockviewDropOverlays(api);
    return false;
  }
  const key = `${targetGroupId}:${position}`;
  if (key === lastShownKey) {
    return true;
  }
  lastShownKey = key;
  let shown = false;
  const groups = api.groups ?? [];
  // Groups share one DropTargetAnchorContainer. clearOverlay() wipes that
  // host, so clear non-targets first, then show the hovered group.
  for (const group of groups) {
    if (groupIdOf(group) !== targetGroupId) {
      dropTargetOf(group)?.clearOverlay();
    }
  }
  for (const group of groups) {
    if (groupIdOf(group) !== targetGroupId) {
      continue;
    }
    const target = dropTargetOf(group);
    if (!target) {
      continue;
    }
    target.showOverlay(position);
    shown = true;
  }
  if (!shown) {
    lastShownKey = null;
  }
  return shown;
}

function idle(api: DockviewApi | null): void {
  if (api) {
    clearDockviewDropOverlays(api);
  }
  releaseWebOverlay();
}

function syncTearOff(
  preview: PanelTransferOverlayPreview,
  input: {
    getApi: () => DockviewApi | null;
    windowId: string | null;
  }
): void {
  const api = input.getApi();
  const windowId = input.windowId;
  if (preview.kind === "clear") {
    revealPanelTransferTearOff();
    return;
  }
  if (preview.kind === "source") {
    if (!windowId || preview.windowId === windowId) {
      revealPanelTransferTearOff();
    }
    return;
  }
  if (preview.kind === "target" && windowId && preview.windowId === windowId) {
    return;
  }
  const panelId = getActiveDrag()?.panelId;
  if (panelId) {
    hidePanelTransferTearOff(panelId, api);
  }
}

export function applyPanelTransferOverlayPreview(
  preview: PanelTransferOverlayPreview,
  input: {
    getApi: () => DockviewApi | null;
    windowId: string | null;
  }
): void {
  const api = input.getApi();
  const windowId = input.windowId;
  syncTearOff(preview, input);
  if (preview.kind === "clear") {
    idle(api);
    return;
  }
  if (preview.kind === "outside") {
    idle(api);
    return;
  }
  if (preview.kind === "source") {
    // This window is the drag source: leave Dockview's HTML5 overlay alone.
    // Unknown windowId: same — do not clearOverlay (would blank in-window UX).
    if (!windowId || preview.windowId === windowId) {
      releaseWebOverlay();
      return;
    }
    idle(api);
    return;
  }
  if (!(windowId && preview.windowId === windowId)) {
    idle(api);
    return;
  }
  if (!api) {
    idle(null);
    return;
  }
  const shown = showDockviewDropOverlayAt(
    api,
    preview.clientX,
    preview.clientY
  );
  if (shown) {
    ensureWebOverlay();
    return;
  }
  idle(api);
}

const ENDED_TRANSFER_TTL_MS = 10 * 60_000;

export function createPanelTransferOverlayPreviewSession(input: {
  getApi: () => DockviewApi | null;
  getWindowId: () => string | null;
}): {
  apply(preview: unknown): void;
  begin(transferId: string): void;
  dispose(): void;
  end(transferId?: string): void;
  refresh(): void;
} {
  let liveId: string | null = null;
  const endedIds = new Map<string, number>();
  let lastPreview: PanelTransferOverlayPreview | null = null;
  const run = (preview: PanelTransferOverlayPreview): void => {
    applyPanelTransferOverlayPreview(preview, {
      getApi: input.getApi,
      windowId: input.getWindowId(),
    });
  };
  const pruneEnded = (): void => {
    const t = Date.now();
    for (const [id, expiresAt] of endedIds) {
      if (expiresAt <= t) {
        endedIds.delete(id);
      }
    }
  };
  const isEnded = (transferId: string): boolean => {
    pruneEnded();
    return endedIds.has(transferId);
  };
  const endTransfer = (transferId?: string): void => {
    const id = transferId ?? liveId;
    if (!id) {
      idle(input.getApi());
      return;
    }
    endedIds.set(id, Date.now() + ENDED_TRANSFER_TTL_MS);
    // Only skip idle when a different transfer is live. A leftover
    // fullscreen web overlay with liveId == null still blocks the terminal.
    if (liveId && liveId !== id) {
      return;
    }
    liveId = null;
    lastPreview = null;
    idle(input.getApi());
  };
  return {
    apply(preview) {
      const parsed = panelTransferOverlayPreviewSchema.safeParse(preview);
      if (!parsed.success) {
        return;
      }
      const next = parsed.data;
      if (isEnded(next.transferId)) {
        return;
      }
      if (next.kind === "clear") {
        endTransfer(next.transferId);
        return;
      }
      if (liveId && liveId !== next.transferId) {
        return;
      }
      if (!liveId) {
        liveId = next.transferId;
      }
      lastPreview = next;
      run(next);
    },
    begin(transferId) {
      pruneEnded();
      endedIds.delete(transferId);
      if (liveId && liveId !== transferId) {
        endTransfer(liveId);
      }
      liveId = transferId;
    },
    dispose() {
      liveId = null;
      lastPreview = null;
      endedIds.clear();
      idle(input.getApi());
    },
    end(transferId) {
      endTransfer(transferId);
    },
    refresh() {
      if (!lastPreview || isEnded(lastPreview.transferId)) {
        return;
      }
      if (liveId && liveId !== lastPreview.transferId) {
        return;
      }
      run(lastPreview);
    },
  };
}

export function resetPanelTransferOverlayPreviewForTests(): void {
  lastShownKey = null;
  releaseWebOverlay();
}
