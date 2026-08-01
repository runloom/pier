/**
 * Process-level "update ready" notification.
 *
 * Fired once on main state edge → downloaded (not from each renderer mirror).
 * Avoids multi-window double toast when every window applied the same snapshot.
 *
 * NCS access is injected so this module stays free of ipc/electron window graph
 * (unit tests can pass a fake service without loading Electron).
 */
import {
  type AppUpdateUiLocale,
  formatAppUpdateReadyCopy,
} from "@shared/app-update-copy.ts";
import {
  NOTIFICATION_DEDUPE_WINDOW_MS,
  type NotificationReport,
} from "@shared/contracts/notification-center.ts";
import { createLogger } from "@shared/logger.ts";

const log = createLogger("app-update.notify-ready");

const TITLE_KEY = "settings.appUpdate.toast.ready";
const RESTART_ACTION_LABEL_KEY = "settings.appUpdate.action.restart";

export function appUpdateReadyDedupeKey(version: string): string {
  return `app-update:${version}`;
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
    titleKey: TITLE_KEY,
    trigger: "system-event",
    ...(suppressToast ? { suppressToast: true } : {}),
  };
}

export function shouldSuppressAppUpdateReadyToast(
  items: ReadonlyArray<{ dedupeKey?: string | undefined; ts: number }>,
  version: string,
  now: number = Date.now()
): boolean {
  const dedupeKey = appUpdateReadyDedupeKey(version);
  return items.some(
    (item) =>
      item.dedupeKey === dedupeKey &&
      now - item.ts <= NOTIFICATION_DEDUPE_WINDOW_MS
  );
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
