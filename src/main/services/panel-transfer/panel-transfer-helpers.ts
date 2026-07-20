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
import {
  PANEL_TRANSFER_NEW_WINDOW_CURSOR_OFFSET,
  PANEL_TRANSFER_PROBE_TIMEOUT_MS,
  PANEL_TRANSFER_TARGET_READY_POLL_MS,
  PANEL_TRANSFER_TARGET_READY_WAIT_MS,
} from "./panel-transfer-types.ts";

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
    getCurrentLifecycleId: () => "",
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
      return await rendererCommand.execute(
        {
          outcome: input.outcome,
          role: input.role,
          transferId: input.transferId,
          type: "panelTransfer.finalize",
        },
        { windowId: input.windowId }
      );
    },
    async prepareSource(input) {
      return await rendererCommand.execute(
        {
          sourcePanelId: input.sourcePanelId,
          transferId: input.transferId,
          type: "panelTransfer.prepareSource",
        },
        { windowId: input.windowId }
      );
    },
    async probeWorkspace(input) {
      return await rendererCommand.execute(
        { type: "panelTransfer.probeWorkspace" },
        {
          timeoutMs: PANEL_TRANSFER_PROBE_TIMEOUT_MS,
          windowId: input.windowId,
        }
      );
    },
    async releaseSource(input) {
      return await rendererCommand.execute(
        {
          sourcePanelId: input.sourcePanelId,
          transferId: input.transferId,
          type: "panelTransfer.releaseSource",
        },
        { windowId: input.windowId }
      );
    },
    async resolvePlacement(input) {
      return await rendererCommand.execute(
        {
          clientX: input.clientX,
          clientY: input.clientY,
          transferId: input.transferId,
          type: "panelTransfer.resolvePlacement",
        },
        { windowId: input.windowId }
      );
    },
    async stageTarget(input) {
      return await rendererCommand.execute(
        {
          panel: input.panel,
          placement: input.placement,
          prepared: input.prepared,
          targetPanelId: input.targetPanelId,
          transferId: input.transferId,
          type: "panelTransfer.stageTarget",
        },
        { windowId: input.windowId }
      );
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
  const infos = windows.list();
  const infoById = new Map(infos.map((info) => [info.id, info]));

  const hit = (windowId: string): boolean => {
    const bounds = geometry.getWindowBounds(windowId);
    if (!bounds) {
      return false;
    }
    return pointInWindowBounds(cursor, {
      height: bounds.height ?? 0,
      width: bounds.width ?? 0,
      x: bounds.x ?? 0,
      y: bounds.y ?? 0,
    });
  };

  // True z-order when available: overlapping windows resolve by what the
  // user visually sees on top — including the source losing to a target
  // window stacked above it.
  const zOrder = geometry.getWindowZOrderTopFirst();
  if (zOrder && zOrder.length > 0) {
    const ordered = [
      ...zOrder.filter((id) => infoById.has(id)),
      ...infos.map((info) => info.id).filter((id) => !zOrder.includes(id)),
    ];
    for (const windowId of ordered) {
      if (!hit(windowId)) {
        continue;
      }
      if (windowId === sourceWindowId) {
        return { kind: "source" as const };
      }
      const info = infoById.get(windowId);
      if (!info) {
        continue;
      }
      return {
        kind: "managed" as const,
        recordId: info.recordId,
        windowId,
      };
    }
    return { kind: "outside" as const };
  }

  // Fallback (no z-order source): source bounds first, then most recently
  // focused first as the closest z-order proxy.
  if (hit(sourceWindowId)) {
    return { kind: "source" as const };
  }
  const candidates = [...infos].sort(
    (a, b) => (b.lastFocusedAt ?? 0) - (a.lastFocusedAt ?? 0)
  );
  for (const windowInfo of candidates) {
    if (windowInfo.id === sourceWindowId) {
      continue;
    }
    if (hit(windowInfo.id)) {
      return {
        kind: "managed" as const,
        recordId: windowInfo.recordId,
        windowId: windowInfo.id,
      };
    }
  }
  return { kind: "outside" as const };
}

function probeReportsReady(result: { data?: unknown; ok: boolean }): boolean {
  if (!(result.ok && result.data) || typeof result.data !== "object") {
    return false;
  }
  return (
    "ready" in result.data &&
    (result.data as { ready?: unknown }).ready === true
  );
}

/**
 * Poll until the target window's Dockview api is set (or abort / deadline).
 * New transfer windows race createForTransfer → stageTarget against renderer
 * bootstrap; without this wait stageTarget fails with "workspace api not ready"
 * or times out while the listener is not yet installed.
 */
export async function waitForTargetWorkspaceReady(
  renderer: PanelTransferRendererPort,
  windowId: string,
  signal: AbortSignal,
  sleepFn: (
    ms: number,
    signal?: AbortSignal
  ) => Promise<void> = defaultPanelTransferSleep
): Promise<void> {
  const deadline = Date.now() + PANEL_TRANSFER_TARGET_READY_WAIT_MS;
  let lastMessage = "target workspace not ready";
  while (Date.now() < deadline) {
    if (signal.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    try {
      const result = await renderer.probeWorkspace({ windowId });
      if (probeReportsReady(result)) {
        return;
      }
      if (!result.ok) {
        lastMessage = result.error?.message ?? lastMessage;
      }
    } catch (error) {
      lastMessage =
        error instanceof Error ? error.message : String(error ?? lastMessage);
    }
    await sleepFn(PANEL_TRANSFER_TARGET_READY_POLL_MS, signal);
  }
  throw new Error(
    `target workspace api not ready within ${PANEL_TRANSFER_TARGET_READY_WAIT_MS}ms: ${lastMessage}`
  );
}
