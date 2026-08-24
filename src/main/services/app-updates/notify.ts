/**
 * Process-level app-update notifications (ready + background error).
 *
 * Fired once on main state edges (→ downloaded / → retryable error from a
 * background trigger) — not from each renderer mirror. Avoids multi-window
 * double toast when every window applied the same snapshot.
 *
 * NCS access is injected so this module stays free of ipc/electron window graph
 * (unit tests can pass a fake service without loading Electron).
 */
import {
  type AppUpdateUiLocale,
  formatAppUpdateErrorCopy,
  formatAppUpdateReadyCopy,
} from "@shared/app-update-copy.ts";
import type { AppUpdateErrorKind } from "@shared/contracts/app-update.ts";
import {
  NOTIFICATION_DEDUPE_WINDOW_MS,
  type NotificationReport,
} from "@shared/contracts/notification-center.ts";
import { createLogger } from "@shared/logger.ts";

const log = createLogger("app-update.notify");

const ERROR_ACTION_LABEL_KEY = "settings.appUpdate.errorOpenSettings";
const ERROR_TITLE_KEY = "settings.appUpdate.toast.failed";
const READY_TITLE_KEY = "settings.appUpdate.toast.ready";
const RESTART_ACTION_LABEL_KEY = "settings.appUpdate.action.restart";

export function appUpdateReadyDedupeKey(version: string): string {
  return `app-update:${version}`;
}

export function appUpdateErrorDedupeKey(kind: AppUpdateErrorKind): string {
  return `app-update-error:${kind}`;
}

/** Minimal NCS surface used by ready notify (avoids importing ipc module). */
export interface AppUpdateNotifyService {
  ingest(report: NotificationReport): unknown;
  snapshot(): {
    items: ReadonlyArray<{ dedupeKey?: string | undefined; ts: number }>;
  };
}

export interface NotifyAppUpdateReadyDeps {
  getService: () => Promise<AppUpdateNotifyService | null>;
  resolveLocale: () => Promise<AppUpdateUiLocale>;
}

export function buildAppUpdateReadyReport(
  version: string,
  locale: AppUpdateUiLocale,
  suppressToast: boolean
): NotificationReport {
  const copy = formatAppUpdateReadyCopy(version, locale);
  return {
    actions: [{ id: "relaunch", labelKey: RESTART_ACTION_LABEL_KEY }],
    body: copy.body,
    dedupeKey: appUpdateReadyDedupeKey(version),
    kind: "app.update",
    severity: "success",
    source: "host",
    title: copy.title,
    titleKey: READY_TITLE_KEY,
    trigger: "system-event",
    ...(suppressToast ? { suppressToast: true } : {}),
  };
}

function dedupeKeySeenWithinWindow(
  items: ReadonlyArray<{ dedupeKey?: string | undefined; ts: number }>,
  dedupeKey: string,
  now: number
): boolean {
  return items.some(
    (item) =>
      item.dedupeKey === dedupeKey &&
      now - item.ts <= NOTIFICATION_DEDUPE_WINDOW_MS
  );
}

export function shouldSuppressAppUpdateReadyToast(
  items: ReadonlyArray<{ dedupeKey?: string | undefined; ts: number }>,
  version: string,
  now: number = Date.now()
): boolean {
  return dedupeKeySeenWithinWindow(
    items,
    appUpdateReadyDedupeKey(version),
    now
  );
}

export function buildAppUpdateErrorReport(
  kind: AppUpdateErrorKind,
  locale: AppUpdateUiLocale,
  suppressToast: boolean
): NotificationReport {
  const copy = formatAppUpdateErrorCopy(locale);
  return {
    actionParams: { section: "updates" },
    actions: [{ id: "open-settings", labelKey: ERROR_ACTION_LABEL_KEY }],
    body: copy.body,
    dedupeKey: appUpdateErrorDedupeKey(kind),
    kind: "app.update",
    severity: "warning",
    source: "host",
    title: copy.title,
    titleKey: ERROR_TITLE_KEY,
    trigger: "system-event",
    ...(suppressToast ? { suppressToast: true } : {}),
  };
}

export function shouldSuppressAppUpdateErrorToast(
  items: ReadonlyArray<{ dedupeKey?: string | undefined; ts: number }>,
  kind: AppUpdateErrorKind,
  now: number = Date.now()
): boolean {
  return dedupeKeySeenWithinWindow(items, appUpdateErrorDedupeKey(kind), now);
}

/**
 * Ingest a ready notification. Same version within the dedupe window only
 * refreshes the inbox entry (suppressToast) — no second shape-B toast.
 */
export function notifyAppUpdateReady(
  version: string,
  deps: NotifyAppUpdateReadyDeps
): void {
  if (!version) {
    return;
  }

  (async () => {
    try {
      const service = await deps.getService();
      if (!service) {
        return;
      }
      const locale = await deps.resolveLocale();
      const suppressToast = shouldSuppressAppUpdateReadyToast(
        service.snapshot().items,
        version
      );
      service.ingest(buildAppUpdateReadyReport(version, locale, suppressToast));
    } catch (err) {
      log.warn("notify ready failed", { err, version });
    }
  })().catch((err: unknown) => {
    log.warn("notify ready failed", { err, version });
  });
}

/**
 * Ingest a background-failure notification. Same error kind within the dedupe
 * window only refreshes the inbox entry (suppressToast) — no second toast.
 */
export function notifyAppUpdateError(
  kind: AppUpdateErrorKind,
  deps: NotifyAppUpdateReadyDeps
): void {
  (async () => {
    try {
      const service = await deps.getService();
      if (!service) {
        return;
      }
      const locale = await deps.resolveLocale();
      const suppressToast = shouldSuppressAppUpdateErrorToast(
        service.snapshot().items,
        kind
      );
      service.ingest(buildAppUpdateErrorReport(kind, locale, suppressToast));
    } catch (err) {
      log.warn("notify error failed", { err, kind });
    }
  })().catch((err: unknown) => {
    log.warn("notify error failed", { err, kind });
  });
}
