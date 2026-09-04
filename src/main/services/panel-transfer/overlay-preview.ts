/**
 * Path B live drop preview. HTML5 dragover does not reach other
 * WebContentsView windows, so main polls the cursor against window bounds
 * and broadcasts classification. Source overlay hide is dockview-core's
 * document-dragleave / document-dragend patch plus renderer `clearOverlay`;
 * the hovered target drives Dockview `showOverlay` from these coordinates.
 */

import type { PanelTransferOverlayPreview } from "@shared/contracts/panel-transfer.ts";
import { classifyTransferCursor } from "./helpers.ts";
import {
  createSpeculativeTransferWindow,
  type SpeculativeTransferWindow,
} from "./speculative-window.ts";
import type {
  OverlayPreviewScheduleHandle,
  OverlayPreviewScheduler,
  PanelTransferGeometryPort,
  PanelTransferWindowPort,
} from "./types.ts";
import {
  PANEL_TRANSFER_OVERLAY_PREVIEW_INTERVAL_MS,
  PANEL_TRANSFER_OVERLAY_PREVIEW_QUANTIZE_PX,
  PANEL_TRANSFER_TOMBSTONE_TTL_MS,
} from "./types.ts";

export type {
  OverlayPreviewScheduleHandle,
  OverlayPreviewScheduler,
} from "./types.ts";

export interface PanelTransferOverlayPreviewController {
  seal(transferId: string): void;
  start(transferId: string, sourceWindowId: string): void;
}

function defaultScheduler(): OverlayPreviewScheduler {
  return {
    interval(callback, ms) {
      const timer = setInterval(callback, ms);
      timer.unref?.();
      return {
        dispose() {
          clearInterval(timer);
        },
      };
    },
  };
}

function quantize(value: number, px: number): number {
  return Math.round(value / px) * px;
}

function screenToContentClient(
  geometry: PanelTransferGeometryPort,
  windowId: string
): { clientX: number; clientY: number } | null {
  const cursor = geometry.getCursorScreenPoint();
  const bounds =
    geometry.getWindowContentBounds(windowId) ??
    geometry.getWindowBounds(windowId);
  if (!bounds) {
    return null;
  }
  return {
    clientX: cursor.x - (bounds.x ?? 0),
    clientY: cursor.y - (bounds.y ?? 0),
  };
}

function fingerprintOf(preview: PanelTransferOverlayPreview): string {
  if (preview.kind === "clear" || preview.kind === "outside") {
    return `${preview.kind}:${preview.transferId}`;
  }
  if (preview.kind === "source") {
    return `source:${preview.transferId}:${preview.windowId}`;
  }
  const px = PANEL_TRANSFER_OVERLAY_PREVIEW_QUANTIZE_PX;
  return `target:${preview.transferId}:${preview.windowId}:${quantize(preview.clientX, px)}:${quantize(preview.clientY, px)}`;
}

export function createOptionalOverlayPreviewController(args: {
  broadcast?: (preview: PanelTransferOverlayPreview) => void;
  geometry: PanelTransferGeometryPort;
  ignoreWindowIds?: () => ReadonlySet<string>;
  onPreview?: (
    preview: PanelTransferOverlayPreview,
    sourceWindowId: string
  ) => void;
  schedule?: OverlayPreviewScheduler;
  windows: PanelTransferWindowPort;
}): PanelTransferOverlayPreviewController | null {
  if (!args.broadcast) {
    return null;
  }
  return createPanelTransferOverlayPreviewController({
    broadcast: args.broadcast,
    geometry: args.geometry,
    windows: args.windows,
    ...(args.ignoreWindowIds === undefined
      ? {}
      : { ignoreWindowIds: args.ignoreWindowIds }),
    ...(args.onPreview === undefined ? {} : { onPreview: args.onPreview }),
    ...(args.schedule === undefined ? {} : { schedule: args.schedule }),
  });
}

export function createPanelTransferOverlayPreviewController(args: {
  broadcast: (preview: PanelTransferOverlayPreview) => void;
  geometry: PanelTransferGeometryPort;
  ignoreWindowIds?: () => ReadonlySet<string>;
  intervalMs?: number;
  now?: () => number;
  onPreview?: (
    preview: PanelTransferOverlayPreview,
    sourceWindowId: string
  ) => void;
  schedule?: OverlayPreviewScheduler;
  windows: PanelTransferWindowPort;
}): PanelTransferOverlayPreviewController {
  const schedule = args.schedule ?? defaultScheduler();
  const now = args.now ?? Date.now;
  const intervalMs =
    args.intervalMs ?? PANEL_TRANSFER_OVERLAY_PREVIEW_INTERVAL_MS;
  let active: { sourceWindowId: string; transferId: string } | null = null;
  let handle: OverlayPreviewScheduleHandle | null = null;
  let lastFingerprint: string | null = null;
  const sealed = new Map<string, number>();

  const pruneSealed = (): void => {
    const t = now();
    for (const [id, expiresAt] of sealed) {
      if (expiresAt <= t) {
        sealed.delete(id);
      }
    }
  };

  const emit = (preview: PanelTransferOverlayPreview): void => {
    const fingerprint = fingerprintOf(preview);
    if (fingerprint === lastFingerprint) {
      return;
    }
    lastFingerprint = fingerprint;
    args.broadcast(preview);
    if (active) {
      args.onPreview?.(preview, active.sourceWindowId);
    }
  };

  const tick = (): void => {
    if (!active) {
      return;
    }
    const { sourceWindowId, transferId } = active;
    const classification = classifyTransferCursor(
      args.geometry,
      args.windows,
      sourceWindowId,
      args.ignoreWindowIds?.()
    );
    if (classification.kind === "source") {
      emit({ kind: "source", transferId, windowId: sourceWindowId });
      return;
    }
    if (classification.kind === "managed") {
      const client = screenToContentClient(
        args.geometry,
        classification.windowId
      );
      if (!client) {
        emit({ kind: "outside", transferId });
        return;
      }
      emit({
        clientX: client.clientX,
        clientY: client.clientY,
        kind: "target",
        transferId,
        windowId: classification.windowId,
      });
      return;
    }
    emit({ kind: "outside", transferId });
  };

  const disposeTimer = (): void => {
    handle?.dispose();
    handle = null;
  };

  const sealTransfer = (transferId: string): void => {
    pruneSealed();
    sealed.set(transferId, now() + PANEL_TRANSFER_TOMBSTONE_TTL_MS);
    if (active?.transferId === transferId) {
      disposeTimer();
      active = null;
      lastFingerprint = null;
    }
    emit({ kind: "clear", transferId });
  };

  return {
    seal: sealTransfer,
    start(transferId, sourceWindowId) {
      pruneSealed();
      if (sealed.has(transferId)) {
        return;
      }
      if (
        active?.transferId === transferId &&
        active.sourceWindowId === sourceWindowId &&
        handle
      ) {
        return;
      }
      if (active && active.transferId !== transferId) {
        sealTransfer(active.transferId);
      }
      disposeTimer();
      active = { sourceWindowId, transferId };
      lastFingerprint = null;
      tick();
      handle = schedule.interval(tick, intervalMs);
    },
  };
}

export function createBoundOverlayPreview(args: {
  broadcast?: (preview: PanelTransferOverlayPreview) => void;
  geometry: PanelTransferGeometryPort;
  schedule?: OverlayPreviewScheduler;
  windows: PanelTransferWindowPort;
}): {
  overlayPreview: PanelTransferOverlayPreviewController | null;
  speculative: SpeculativeTransferWindow;
} {
  const speculative = createSpeculativeTransferWindow({
    geometry: args.geometry,
    windows: args.windows,
  });
  const overlayPreview = createOptionalOverlayPreviewController({
    geometry: args.geometry,
    ignoreWindowIds: () => speculative.hiddenIds(),
    onPreview: (preview, sourceWindowId) => {
      if (preview.kind === "outside") {
        speculative.ensure(preview.transferId, sourceWindowId);
        return;
      }
      if (preview.kind === "source") {
        speculative.discard(preview.transferId);
        return;
      }
      if (preview.kind === "target") {
        // Hovering our own warm window is still tear-off, not a managed drop.
        if (speculative.hiddenIds().has(preview.windowId)) {
          return;
        }
        speculative.discard(preview.transferId);
      }
    },
    windows: args.windows,
    ...(args.broadcast === undefined ? {} : { broadcast: args.broadcast }),
    ...(args.schedule === undefined ? {} : { schedule: args.schedule }),
  });
  return { overlayPreview, speculative };
}
