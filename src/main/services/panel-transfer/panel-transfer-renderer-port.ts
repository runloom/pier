import type {
  PanelTransferPlacement,
  PanelTransferSourceSnapshot,
} from "@shared/contracts/panel-transfer.ts";
import type { RendererCommandResult } from "@shared/contracts/renderer-command.ts";

export interface PanelTransferRendererPort {
  finalize(input: {
    outcome: "abort" | "commit";
    role: "source" | "target";
    transferId: string;
    windowId: string;
  }): Promise<RendererCommandResult>;
  prepareSource(input: {
    sourcePanelId: string;
    transferId: string;
    windowId: string;
  }): Promise<RendererCommandResult>;
  releaseSource(input: {
    sourcePanelId: string;
    transferId: string;
    windowId: string;
  }): Promise<RendererCommandResult>;
  stageTarget(input: {
    panel: PanelTransferSourceSnapshot["panel"];
    placement: PanelTransferPlacement;
    prepared: PanelTransferSourceSnapshot["prepared"];
    targetPanelId: string;
    transferId: string;
    windowId: string;
  }): Promise<RendererCommandResult>;
}
