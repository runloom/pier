import type { TerminalDebugSnapshot } from "@shared/contracts/terminal/debug.ts";
import { isResidualStickyWebFocus } from "@shared/terminal-keyboard-target.ts";
import type { ReactNode } from "react";

/**
 * 仅 residual sticky（只剩 pier.click）时展示；与诊断 issue 同谓词。
 * 设置/搜索等 durable 打开中不显示。
 */
export function stickyWebBannerText(
  snapshot: TerminalDebugSnapshot | null
): string | null {
  const desired =
    snapshot?.coordinator?.desired ??
    snapshot?.renderer?.desiredHostSnapshot ??
    null;
  if (!desired) {
    return null;
  }
  const ids = snapshot?.renderer?.focusRouting?.webRequestIds;
  if (
    !isResidualStickyWebFocus({
      basePanel: desired.basePanel,
      webRequestCount: desired.webRequestCount,
      webRequestIds: ids,
    })
  ) {
    return null;
  }
  if (desired.basePanel.kind !== "terminal") {
    return null;
  }
  const idsText = (ids ?? []).join(", ") || "pier.click";
  return `sticky web · base=terminal:${desired.basePanel.panelId} · ${idsText}`;
}

export function RoutingDebugBanners({
  snapshot,
}: {
  snapshot: TerminalDebugSnapshot | null;
}): ReactNode {
  const stickyBanner = stickyWebBannerText(snapshot);
  const lastError = snapshot?.coordinator?.lastError ?? null;
  if (!(stickyBanner || lastError)) {
    return null;
  }
  return (
    <>
      {stickyBanner ? (
        <div className="shrink-0 border border-status-warning-border bg-status-warning-bg px-3 py-2 font-mono text-status-warning-fg text-xs">
          {stickyBanner}
        </div>
      ) : null}
      {lastError ? (
        <div className="shrink-0 border border-status-danger-border bg-status-danger-bg px-3 py-2 font-mono text-status-danger-fg text-xs">
          lastError: {lastError}
        </div>
      ) : null}
    </>
  );
}
