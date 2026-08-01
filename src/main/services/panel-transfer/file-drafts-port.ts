import type { FileDraftsService } from "../files/drafts-types.ts";
import type { PanelTransferFilesPort } from "./types.ts";

/**
 * Production Files port: delegates panel-transfer draft side-effects to
 * FileDraftsService.stageTransfer/commitTransfer/rollbackTransfer.
 *
 * App-core may wire this once the Files identity/coordinator slice is ready.
 */
export function createPanelTransferFilesPort(
  fileDrafts: FileDraftsService
): PanelTransferFilesPort {
  return {
    commitDrafts: (input) => fileDrafts.commitTransfer(input),
    rollbackDrafts: (input) => fileDrafts.rollbackTransfer(input),
    stageDrafts: (input) => fileDrafts.stageTransfer(input),
  };
}
