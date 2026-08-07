import {
  HANG_BREADCRUMB_DIAGNOSTICS_MAX,
  type StoredRendererHangBreadcrumb,
} from "@shared/contracts/renderer-hang-breadcrumb.ts";

/**
 * Process-local hang-trail ring (oldest → newest). Kept free of window/identity
 * imports so forgetAppWindow can clear without an IPC ↔ identity cycle.
 */

const MAX_BREADCRUMBS_PER_WINDOW = HANG_BREADCRUMB_DIAGNOSTICS_MAX;

const breadcrumbsByBrowserWindowId = new Map<
  number,
  StoredRendererHangBreadcrumb[]
>();

export function rememberHangBreadcrumb(
  browserWindowId: number,
  crumb: StoredRendererHangBreadcrumb
): void {
  const list = breadcrumbsByBrowserWindowId.get(browserWindowId) ?? [];
  list.push(crumb);
  while (list.length > MAX_BREADCRUMBS_PER_WINDOW) {
    list.shift();
  }
  breadcrumbsByBrowserWindowId.set(browserWindowId, list);
}

/** Full ring for a BrowserWindow.id (oldest → newest). */
export function getHangBreadcrumbsForWindow(
  browserWindowId: number
): readonly StoredRendererHangBreadcrumb[] {
  return breadcrumbsByBrowserWindowId.get(browserWindowId) ?? [];
}

/**
 * Newest crumbs only, sized for diagnostics JSONL (keeps newest under
 * MAX_ARRAY_ITEMS; avoids dropping the hang-critical tail).
 */
export function getHangBreadcrumbsForDiagnostics(
  browserWindowId: number,
  maxItems: number = HANG_BREADCRUMB_DIAGNOSTICS_MAX
): readonly StoredRendererHangBreadcrumb[] {
  const all = getHangBreadcrumbsForWindow(browserWindowId);
  if (all.length <= maxItems) {
    return all;
  }
  return all.slice(-maxItems);
}

export function clearHangBreadcrumbsForWindow(browserWindowId: number): void {
  breadcrumbsByBrowserWindowId.delete(browserWindowId);
}

export function __resetHangBreadcrumbsForTests(): void {
  breadcrumbsByBrowserWindowId.clear();
}
