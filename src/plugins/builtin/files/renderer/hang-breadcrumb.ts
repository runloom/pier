import type { RendererHangBreadcrumb } from "@shared/contracts/diagnostics/hang-breadcrumb.ts";
import { sanitizeHangBreadcrumbFields } from "@shared/contracts/diagnostics/hang-breadcrumb.ts";

/**
 * Files-plugin hang trail. Must not import host renderer (depcruise) and must
 * not call preload globals (builtin package boundary). Host binds a sink at boot
 * (see renderer main) that forwards into the host hang runtime.
 */
type HangBreadcrumbSink = (payload: RendererHangBreadcrumb) => void;

let sink: HangBreadcrumbSink | null = null;
let lastDedupeKey = "";

/** Host installs once at renderer boot; returns unbind. */
export function installFilesHangBreadcrumbSink(
  next: HangBreadcrumbSink
): () => void {
  sink = next;
  return () => {
    if (sink === next) {
      sink = null;
    }
  };
}

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
    sink?.(crumb);
  } catch {
    // never throw from diagnostics
  }
}
