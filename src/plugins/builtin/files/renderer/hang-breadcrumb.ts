import type { RendererHangBreadcrumb } from "@shared/contracts/renderer-hang-breadcrumb.ts";
import { sanitizeHangBreadcrumbFields } from "@shared/contracts/renderer-hang-breadcrumb.ts";

/**
 * Files-plugin hang trail. Must not import host `src/renderer` (depcruise);
 * only the preload bridge `window.pier.diagnostics`. Events are rare
 * (close / conflict), so send immediately — no host-side batch import.
 */
let lastDedupeKey = "";

export function noteFilesHangBreadcrumb(payload: RendererHangBreadcrumb): void {
  try {
    const crumb = sanitizeHangBreadcrumbFields(payload);
    const key = [
      crumb.kind,
      crumb.phase ?? "",
      crumb.detail ?? "",
      crumb.path ?? "",
      crumb.panelId ?? "",
    ].join("|");
    if (key === lastDedupeKey) {
      return;
    }
    lastDedupeKey = key;
    window.pier?.diagnostics?.hangBreadcrumb?.(crumb);
  } catch {
    // never throw from diagnostics
  }
}
