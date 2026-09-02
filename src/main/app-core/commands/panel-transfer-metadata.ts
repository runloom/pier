import type { CommandMetadata } from "./metadata-table.ts";

export const PANEL_TRANSFER_COMMAND_METADATA: Record<
  | "panelTransfer.bootstrap"
  | "panelTransfer.cancel"
  | "panelTransfer.drop"
  | "panelTransfer.finishDrag"
  | "panelTransfer.offer"
  | "panelTransfer.ready"
  | "panelTransfer.relocate",
  CommandMetadata
> = {
  "panelTransfer.bootstrap": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
  "panelTransfer.cancel": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
  "panelTransfer.drop": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
  "panelTransfer.finishDrag": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
  "panelTransfer.offer": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
  "panelTransfer.ready": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
  "panelTransfer.relocate": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
};
