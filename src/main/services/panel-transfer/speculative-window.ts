/**
 * Warm a hidden transfer window while the cursor is outside every Pier
 * window, so mouseup does not wait on native create. Cursor classification
 * must ignore these ids — Electron may clamp off-screen bounds on-screen.
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

export function createSpeculativeTransferWindow(args: {
  geometry: PanelTransferGeometryPort;
  windows: PanelTransferWindowPort;
}): SpeculativeTransferWindow {
  const slots = new Map<string, Slot>();

  const destroyCreated = (
    transferId: string,
    created: CreatedTransferWindow
  ) => {
    args.windows
      .runExclusive(async (lease) => {
        await args.windows.destroyForTransfer(
          lease,
          created.windowId,
          transferId
        );
      })
      .catch((error: unknown) => {
        console.error(
          "[panelTransfer] speculative destroy failed",
          `transferId=${transferId}`,
          error instanceof Error ? error.message : String(error)
        );
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
      if (slot.phase === "ready" && slot.created) {
        slots.delete(transferId);
        destroyCreated(transferId, slot.created);
      }
    },
    ensure(transferId, sourceWindowId) {
      const existing = slots.get(transferId);
      if (existing && !existing.cancelled) {
        return;
      }
      const slot: Slot = {
        cancelled: false,
        created: null,
        phase: "creating",
        promise: Promise.resolve(null),
      };
      slot.promise = start(transferId, sourceWindowId, slot);
      slots.set(transferId, slot);
    },
    hiddenIds() {
      const ids = new Set<string>();
      for (const slot of slots.values()) {
        if (slot.cancelled || !slot.created) {
          continue;
        }
        ids.add(slot.created.windowId);
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
    input.windows.setBounds(taken.windowId, bounds);
    input.windows.holdRendererShow(
      taken.windowId,
      PANEL_TRANSFER_SHOW_HOLD_REASON
    );
    input.windows.revealHost(taken.windowId);
    return taken;
  }
  const created = await input.windows.createForTransfer(input.lease, {
    bounds,
    transferId: input.transferId,
  });
  input.windows.holdRendererShow(
    created.windowId,
    PANEL_TRANSFER_SHOW_HOLD_REASON
  );
  input.windows.revealHost(created.windowId);
  return created;
}
