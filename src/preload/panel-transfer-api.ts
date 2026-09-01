import type {
  PanelTransferBootstrapState,
  PanelTransferOffer,
  PanelTransferOverlayPreview,
  PanelTransferPlacement,
  PanelTransferRelocateTarget,
  PanelTransferResult,
} from "@shared/contracts/panel-transfer.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { invokePierCommand, subscribeIpc } from "./ipc-envelope.ts";

/**
 * Preload surface for cross-window panel transfer.
 * Path B: target claim is main-mediated (`drop` / native-monitor + bounds).
 * Source may still stamp local DataTransfer for same-window Dockview / diagnostics;
 * this API does not parse foreign WebContents MIME as the claim path.
 * Intentional menu/command moves use `relocate` (no HTML5 drag).
 */
export interface PierPanelTransferAPI {
  bootstrap(): Promise<PanelTransferBootstrapState>;
  cancel(transferId: string): Promise<void>;
  drop(input: {
    transferId: string;
    placement: PanelTransferPlacement;
  }): Promise<PanelTransferResult>;
  finishDrag(transferId: string): Promise<PanelTransferResult | null>;
  offer(input: PanelTransferOffer): Promise<{ accepted: boolean }>;
  onOverlayPreview(
    cb: (preview: PanelTransferOverlayPreview) => void
  ): () => void;
  ready(transferId: string): Promise<PanelTransferResult | null>;
  relocate(input: {
    transferId: string;
    target: PanelTransferRelocateTarget;
    placement?: PanelTransferPlacement;
  }): Promise<PanelTransferResult>;
}

export function createPanelTransferApi(): PierPanelTransferAPI {
  return {
    bootstrap: () =>
      invokePierCommand<PanelTransferBootstrapState>({
        type: "panelTransfer.bootstrap",
      }),
    cancel: async (transferId) => {
      await invokePierCommand<null>({
        transferId,
        type: "panelTransfer.cancel",
      });
    },
    drop: (input) =>
      invokePierCommand<PanelTransferResult>({
        placement: input.placement,
        transferId: input.transferId,
        type: "panelTransfer.drop",
      }),
    finishDrag: (transferId) =>
      invokePierCommand<PanelTransferResult | null>({
        transferId,
        type: "panelTransfer.finishDrag",
      }),
    offer: (input) =>
      invokePierCommand<{ accepted: boolean }>({
        offer: input,
        type: "panelTransfer.offer",
      }),
    onOverlayPreview: (cb) =>
      subscribeIpc(PIER_BROADCAST.PANEL_TRANSFER_OVERLAY_PREVIEW, cb),
    ready: (transferId) =>
      invokePierCommand<PanelTransferResult | null>({
        transferId,
        type: "panelTransfer.ready",
      }),
    relocate: (input) =>
      invokePierCommand<PanelTransferResult>({
        placement: input.placement,
        target: input.target,
        transferId: input.transferId,
        type: "panelTransfer.relocate",
      }),
  };
}
