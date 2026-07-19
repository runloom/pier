import type {
  PanelTransferBootstrapState,
  PanelTransferOffer,
  PanelTransferPlacement,
  PanelTransferResult,
} from "@shared/contracts/panel-transfer.ts";
import { invokePierCommand } from "./ipc-envelope.ts";

/**
 * Preload surface for cross-window panel transfer.
 * Path B: target claim is main-mediated (`drop` / native-monitor + bounds).
 * Source may still stamp local DataTransfer for same-window Dockview / diagnostics;
 * this API does not parse foreign WebContents MIME as the claim path.
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
  ready(transferId: string): Promise<PanelTransferResult | null>;
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
    ready: (transferId) =>
      invokePierCommand<PanelTransferResult | null>({
        transferId,
        type: "panelTransfer.ready",
      }),
  };
}
