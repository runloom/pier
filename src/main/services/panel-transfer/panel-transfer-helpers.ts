import type { PanelTransferResult } from "@shared/contracts/panel-transfer.ts";
import type { RendererCommandService } from "../renderer-command-service.ts";
import type { PanelTransferRendererPort } from "./panel-transfer-renderer-port.ts";
import type {
  PanelTransferCaller,
  PanelTransferFilesPort,
  PanelTransferGeometryPort,
  PanelTransferTerminalPort,
  PanelTransferWindowPort,
} from "./panel-transfer-types.ts";
import { PANEL_TRANSFER_NEW_WINDOW_CURSOR_OFFSET } from "./panel-transfer-types.ts";

export function createNoopPanelTransferFilesPort(): PanelTransferFilesPort {
  return {
    commitDrafts: async () => undefined,
    rollbackDrafts: async () => undefined,
    stageDrafts: async () => undefined,
  };
}

export function createNoopPanelTransferTerminalPort(): PanelTransferTerminalPort {
  return {
    commitMove: async () => undefined,
    rollback: async () => undefined,
    stageLease: async () => undefined,
  };
}

export function defaultPanelTransferSleep(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  const onAbort = () => {
    clearTimeout(timer);
    reject(new DOMException("aborted", "AbortError"));
  };
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      return Promise.reject(new DOMException("aborted", "AbortError"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return promise;
}

export function samePanelTransferCaller(
  a: PanelTransferCaller,
  b: PanelTransferCaller
): boolean {
  return (
    a.runtimeWindowId === b.runtimeWindowId &&
    a.windowRecordId === b.windowRecordId &&
    a.webContentsId === b.webContentsId
  );
}

export function sanitizePanelTransferMessage(message: string): string {
  return message.replace(/\/Users\/[^\s]+/g, "[path]").slice(0, 500);
}

export function panelTransferFailure(
  code: Extract<PanelTransferResult, { ok: false }>["code"],
  message: string
): PanelTransferResult {
  return { code, message: sanitizePanelTransferMessage(message), ok: false };
}

export function pointInWindowBounds(
  point: { x: number; y: number },
  bounds: { height: number; width: number; x: number; y: number }
): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function createPanelTransferRendererPort(
  rendererCommand: RendererCommandService
): PanelTransferRendererPort {
  return {
    async finalize(input) {
      return await rendererCommand.execute({
        outcome: input.outcome,
        role: input.role,
        transferId: input.transferId,
        type: "panelTransfer.finalize",
        windowId: input.windowId,
      });
    },
    async prepareSource(input) {
      return await rendererCommand.execute({
        sourcePanelId: input.sourcePanelId,
        transferId: input.transferId,
        type: "panelTransfer.prepareSource",
        windowId: input.windowId,
      });
    },
    async releaseSource(input) {
      return await rendererCommand.execute({
        sourcePanelId: input.sourcePanelId,
        transferId: input.transferId,
        type: "panelTransfer.releaseSource",
        windowId: input.windowId,
      });
    },
    async stageTarget(input) {
      return await rendererCommand.execute({
        panel: input.panel,
        placement: input.placement,
        prepared: input.prepared,
        targetPanelId: input.targetPanelId,
        transferId: input.transferId,
        type: "panelTransfer.stageTarget",
        windowId: input.windowId,
      });
    },
  };
}

export function computeTransferNewWindowBounds(
  geometry: PanelTransferGeometryPort,
  sourceWindowId: string
) {
  const cursor = geometry.getCursorScreenPoint();
  const sourceBounds = geometry.getWindowBounds(sourceWindowId) ?? {
    height: 800,
    width: 1280,
    x: cursor.x,
    y: cursor.y,
  };
  const workArea = geometry.getDisplayWorkAreaNear(cursor);
  const width = sourceBounds.width ?? 1280;
  const height = sourceBounds.height ?? 800;
  const x = clampNumber(
    cursor.x - PANEL_TRANSFER_NEW_WINDOW_CURSOR_OFFSET,
    workArea.x,
    workArea.x + Math.max(workArea.width - width, 0)
  );
  const y = clampNumber(
    cursor.y - PANEL_TRANSFER_NEW_WINDOW_CURSOR_OFFSET,
    workArea.y,
    workArea.y + Math.max(workArea.height - height, 0)
  );
  return { height, width, x, y };
}

export function classifyTransferCursor(
  geometry: PanelTransferGeometryPort,
  windows: PanelTransferWindowPort,
  sourceWindowId: string
) {
  const cursor = geometry.getCursorScreenPoint();
  const sourceBounds = geometry.getWindowBounds(sourceWindowId);
  if (
    sourceBounds &&
    pointInWindowBounds(cursor, {
      height: sourceBounds.height ?? 0,
      width: sourceBounds.width ?? 0,
      x: sourceBounds.x ?? 0,
      y: sourceBounds.y ?? 0,
    })
  ) {
    return { kind: "source" as const };
  }
  for (const windowInfo of windows.list()) {
    if (windowInfo.id === sourceWindowId) {
      continue;
    }
    const bounds = geometry.getWindowBounds(windowInfo.id);
    if (!bounds) {
      continue;
    }
    if (
      pointInWindowBounds(cursor, {
        height: bounds.height ?? 0,
        width: bounds.width ?? 0,
        x: bounds.x ?? 0,
        y: bounds.y ?? 0,
      })
    ) {
      return {
        kind: "managed" as const,
        recordId: windowInfo.recordId,
        windowId: windowInfo.id,
      };
    }
  }
  return { kind: "outside" as const };
}
