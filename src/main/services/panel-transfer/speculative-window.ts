/**
 * Warm a hidden transfer window while the cursor is outside every Pier
 * window, so mouseup does not wait on native create. Cursor classification
 * and HTML5 drop must ignore these ids — otherwise the warm window is
 * claimed as managed and never revealed.
 */

import type { WindowTransitionLease } from "../window-service.ts";
import { computeTransferNewWindowBounds } from "./helpers.ts";
import {
  PANEL_TRANSFER_SHOW_HOLD_REASON,
  type PanelTransferGeometryPort,
  type PanelTransferWindowPort,
} from "./types.ts";

export interface CreatedTransferWindow {
  recordId: string;
  windowId: string;
}

interface Slot {
  cancelled: boolean;
  created: CreatedTransferWindow | null;
  /** Window ids that existed when `ensure` started. New ids are ours. */
  knownWindowIds: ReadonlySet<string>;
  phase: "creating" | "ready";
  promise: Promise<CreatedTransferWindow | null>;
}

export interface SpeculativeTransferWindow {
  awaitReady(transferId: string): Promise<CreatedTransferWindow | null>;
  discard(transferId: string): void;
  ensure(transferId: string, sourceWindowId: string): void;
  hiddenIds(): ReadonlySet<string>;
  take(transferId: string): CreatedTransferWindow | null;
}

function revealTransferHost(
  windows: PanelTransferWindowPort,
  windowId: string,
  bounds: { height: number; width: number; x: number; y: number }
): void {
  windows.holdRendererShow(windowId, PANEL_TRANSFER_SHOW_HOLD_REASON);
  // Window is already showInactive at opacity 0. Position while hidden so
  // forceReveal does not flash the source-display clamp rect, then set
  // again after show in case Electron ignored the first other-display move.
  windows.setBounds(windowId, bounds);
  windows.revealHost(windowId);
  windows.setBounds(windowId, bounds);
}

export function createSpeculativeTransferWindow(args: {
  geometry: PanelTransferGeometryPort;
  windows: PanelTransferWindowPort;
}): SpeculativeTransferWindow {
  const slots = new Map<string, Slot>();
  const destroyingIds = new Set<string>();
  const dyingIds = new Set<string>();

  const destroyCreated = (
    transferId: string,
    created: CreatedTransferWindow
  ) => {
    dyingIds.add(created.windowId);
    if (destroyingIds.has(created.windowId)) {
      return;
    }
    destroyingIds.add(created.windowId);
    args.windows
      .runExclusive(async (lease) => {
        await args.windows.destroyForTransfer(
          lease,
          created.windowId,
          transferId
        );
        dyingIds.delete(created.windowId);
      })
      .catch((error: unknown) => {
        console.error(
          "[panelTransfer] speculative destroy failed",
          `transferId=${transferId}`,
          error instanceof Error ? error.message : String(error)
        );
      })
      .finally(() => {
        destroyingIds.delete(created.windowId);
      });
  };

  const start = async (
    transferId: string,
    sourceWindowId: string,
    slot: Slot
  ): Promise<CreatedTransferWindow | null> => {
    try {
      const created = await args.windows.runExclusive(async (lease) => {
        if (slot.cancelled) {
          return null;
        }
        const bounds = computeTransferNewWindowBounds(
          args.geometry,
          sourceWindowId
        );
        const next = await args.windows.createForTransfer(lease, {
          bounds,
          transferId,
        });
        // Visible to hiddenIds before this exclusive callback returns —
        // overlay ticks can run while createForTransfer is in flight.
        slot.created = next;
        args.windows.holdRendererShow(
          next.windowId,
          PANEL_TRANSFER_SHOW_HOLD_REASON
        );
        return next;
      });
      if (slots.get(transferId) !== slot) {
        if (created) {
          destroyCreated(transferId, created);
        }
        return null;
      }
      if (!created || slot.cancelled) {
        if (created) {
          destroyCreated(transferId, created);
        }
        slots.delete(transferId);
        return null;
      }
      slot.created = created;
      slot.phase = "ready";
      return created;
    } catch (error) {
      slots.delete(transferId);
      console.error(
        "[panelTransfer] speculative create failed",
        `transferId=${transferId}`,
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  };

  return {
    awaitReady(transferId) {
      const slot = slots.get(transferId);
      if (!slot) {
        return Promise.resolve(null);
      }
      return slot.promise;
    },
    discard(transferId) {
      const slot = slots.get(transferId);
      if (!slot) {
        return;
      }
      slot.cancelled = true;
      if (slot.created) {
        destroyCreated(transferId, slot.created);
      }
      if (slot.phase === "ready") {
        slots.delete(transferId);
      }
    },
    ensure(transferId, sourceWindowId) {
      const existing = slots.get(transferId);
      if (existing && !existing.cancelled) {
        return;
      }
      // Let a cancelled in-flight create finish destroy before warming again,
      // otherwise slots.set would drop its id from hiddenIds.
      if (existing?.cancelled && existing.phase === "creating") {
        return;
      }
      const slot: Slot = {
        cancelled: false,
        created: null,
        knownWindowIds: new Set(args.windows.list().map((info) => info.id)),
        phase: "creating",
        promise: Promise.resolve(null),
      };
      slot.promise = start(transferId, sourceWindowId, slot);
      slots.set(transferId, slot);
    },
    hiddenIds() {
      const ids = new Set(dyingIds);
      for (const slot of slots.values()) {
        if (slot.created) {
          ids.add(slot.created.windowId);
        }
        if (slot.phase !== "creating") {
          continue;
        }
        // createForTransfer inserts the window into list() before it
        // returns; ignore those new ids so classification / HTML5 drop
        // cannot treat the warm window as a managed user target.
        for (const info of args.windows.list()) {
          if (!slot.knownWindowIds.has(info.id)) {
            ids.add(info.id);
          }
        }
      }
      return ids;
    },
    take(transferId) {
      const slot = slots.get(transferId);
      if (
        !(slot && slot.phase === "ready" && slot.created && !slot.cancelled)
      ) {
        return null;
      }
      const created = slot.created;
      slots.delete(transferId);
      return created;
    },
  };
}

export async function materializeInternalTransferWindow(input: {
  geometry: PanelTransferGeometryPort;
  lease: WindowTransitionLease;
  sourceWindowId: string;
  speculative: SpeculativeTransferWindow;
  transferId: string;
  windows: PanelTransferWindowPort;
}): Promise<CreatedTransferWindow> {
  const bounds = computeTransferNewWindowBounds(
    input.geometry,
    input.sourceWindowId
  );
  const taken = input.speculative.take(input.transferId);
  if (taken) {
    revealTransferHost(input.windows, taken.windowId, bounds);
    return taken;
  }
  const created = await input.windows.createForTransfer(input.lease, {
    bounds,
    transferId: input.transferId,
  });
  revealTransferHost(input.windows, created.windowId, bounds);
  return created;
}
