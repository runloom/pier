import type { RendererHangBreadcrumb } from "@shared/contracts/renderer-hang-breadcrumb.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

/**
 * Diagnostics bridges that only write main diagnostics JSONL (no invoke).
 * Hang trail: fire-and-forget single crumb or small batch; never throw.
 */
export interface PierDiagnosticsAPI {
  hangBreadcrumb: (
    payload: RendererHangBreadcrumb | readonly RendererHangBreadcrumb[]
  ) => void;
}

export const diagnosticsApi: PierDiagnosticsAPI = {
  hangBreadcrumb: (payload) => {
    try {
      ipcRenderer.send(PIER.RENDERER_HANG_BREADCRUMB, payload);
    } catch {
      // Diagnostics must never break the product path.
    }
  },
};
