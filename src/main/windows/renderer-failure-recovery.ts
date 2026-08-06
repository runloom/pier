import { createLogger } from "@shared/logger.ts";
import { app, dialog, type WebContents } from "electron";
import type { AppWindow } from "./app-window.ts";
import {
  collectRendererFailureDiagnostics,
  createRendererFailureIncidentTracker,
  formatRendererCrashDetail,
  logRendererProcessGone,
  type RendererFailureIncident,
  type RendererProcessGoneDetails,
  rendererFailureLogCtx,
} from "./renderer-failure-diagnostics.ts";
import {
  buildRendererRecoveryCopy,
  isRendererRecoveryCloseUrl,
  isRendererRecoveryReloadUrl,
  loadRendererRecoveryPage,
} from "./renderer-recovery-page.ts";
import {
  failurePromptOptions,
  isExpectedFailure,
  type RendererFailure,
  type RendererFailureRecovery,
  RendererResourceFailureCoordinator,
} from "./renderer-resource-failure.ts";

export type {
  RendererFailureKind,
  RendererFailureRecovery,
} from "./renderer-resource-failure.ts";
export { RendererResourceFailureCoordinator } from "./renderer-resource-failure.ts";

const log = createLogger("renderer.failure");

export function reportRendererLoadError(
  recovery: RendererFailureRecovery,
  error: unknown
): void {
  const errorCode =
    typeof error === "object" && error !== null
      ? Reflect.get(error, "code")
      : undefined;
  recovery.report({
    detail: String(error),
    ...(typeof errorCode === "number" || typeof errorCode === "string"
      ? { errorCode }
      : {}),
    kind: "load",
  });
}

interface InstallRendererFailureRecoveryArgs {
  beforeLoadFailure(): void;
  beforeRendererGone(): void;
  isContentVisible(): boolean;
  isQuitting(): boolean;
  /** Load the real app entry (not recovery data URL / not bare reload). */
  reloadAppEntry(): void;
  window: AppWindow;
}

const rendererResourceFailures = new RendererResourceFailureCoordinator();

async function presentInPageRecovery(
  window: AppWindow,
  failure: RendererFailure
): Promise<boolean> {
  if (window.isDestroyed() || window.webContents.isDestroyed()) {
    return false;
  }
  try {
    const copy = buildRendererRecoveryCopy({
      detail: failure.detail,
      isChinese: app.getLocale().toLowerCase().startsWith("zh"),
      kind: failure.kind,
    });
    await loadRendererRecoveryPage(window.webContents, copy);
    log.info("recovery-page-loaded", {
      ...(failure.incidentId === undefined
        ? {}
        : { incidentId: failure.incidentId }),
      kind: failure.kind,
      windowId: window.id,
    });
    // Recovery page may be the only interactive surface; ensure the shell is
    // visible so the user can click Reload / Close.
    try {
      window.host.setOpacity(1);
      if (!window.isMinimized()) {
        window.host.show();
      }
      window.focus();
    } catch {
      // ignore chrome visibility failures; page may still be usable
    }
    return true;
  } catch (error) {
    log.error("recovery-page-load-failed", {
      ...(failure.incidentId === undefined
        ? {}
        : { incidentId: failure.incidentId }),
      kind: failure.kind,
      message: error instanceof Error ? error.message : String(error),
      windowId: window.id,
    });
    return false;
  }
}

/** renderer 尚未能渲染错误页时，由 main 提供唯一的重试/关窗兜底。 */
function createRendererFailureRecovery(
  window: AppWindow,
  isQuitting: () => boolean,
  isContentVisible: () => boolean,
  beforeLoadFailure: () => void,
  reloadAppEntry: () => void
): RendererFailureRecovery {
  let promptPending = false;
  let recoveryPagePending = false;
  /** Crash/unresponsive recovery already shown for this incident (no double UI). */
  const presentedIncidents = new Set<string>();

  const presentNative = (failure: RendererFailure): void => {
    if (promptPending || isExpectedFailure(failure, window, isQuitting)) {
      return;
    }
    promptPending = true;
    dialog
      .showMessageBox(failurePromptOptions(failure))
      .then(({ response }) => {
        promptPending = false;
        if (window.isDestroyed()) return;
        if (response === 0) {
          reloadAppEntry();
        } else {
          window.destroy();
        }
      })
      .catch((error: unknown) => {
        promptPending = false;
        console.error("[renderer-failure-feedback] failed:", error);
        if (!window.isDestroyed()) window.destroy();
      });
  };

  const present = (failure: RendererFailure): void => {
    let visible = false;
    try {
      visible = isContentVisible();
    } catch {
      visible = false;
    }
    log.error("renderer-failure", {
      detail: failure.detail.slice(0, 2000),
      ...(failure.incidentId === undefined
        ? {}
        : { incidentId: failure.incidentId }),
      kind: failure.kind,
      visible,
      windowId: window.id,
    });
    if (isExpectedFailure(failure, window, isQuitting)) {
      return;
    }

    // load/preload are shared product-bundle failures — keep multi-window
    // coalesced native prompt so one decision retries all affected shells.
    if (failure.kind === "load" || failure.kind === "preload") {
      beforeLoadFailure();
      rendererResourceFailures.report(
        { isQuitting, retry: reloadAppEntry, window },
        failure
      );
      return;
    }

    if (
      failure.incidentId !== undefined &&
      presentedIncidents.has(failure.incidentId)
    ) {
      log.info("renderer-failure-already-presented", {
        incidentId: failure.incidentId,
        kind: failure.kind,
        windowId: window.id,
      });
      return;
    }
    if (failure.incidentId !== undefined) {
      presentedIncidents.add(failure.incidentId);
    }

    // crash / unresponsive: prefer in-page recovery when the shell is already
    // visible so users get Reload without depending on JS in the dead app.
    // Reuse the safe `visible` snapshot — a second isContentVisible() throw
    // would abort recovery after we already logged the failure.
    if (visible && !recoveryPagePending) {
      recoveryPagePending = true;
      presentInPageRecovery(window, failure)
        .then((ok) => {
          recoveryPagePending = false;
          if (!ok) {
            presentNative(failure);
          }
        })
        .catch(() => {
          recoveryPagePending = false;
          presentNative(failure);
        });
      return;
    }

    presentNative(failure);
  };

  return {
    report(failure) {
      present(failure);
    },
  };
}

/**
 * Compose will-navigate: allow pier-recovery:// actions, deny everything else.
 * Call from window-manager so recovery page links work after load.
 */
export function installRendererNavigationGuard(
  webContents: WebContents,
  handlers: {
    onRecoveryClose(): void;
    onRecoveryReload(): void;
  }
): void {
  webContents.on("will-navigate", (event, url) => {
    if (isRendererRecoveryReloadUrl(url)) {
      event.preventDefault();
      handlers.onRecoveryReload();
      return;
    }
    if (isRendererRecoveryCloseUrl(url)) {
      event.preventDefault();
      handlers.onRecoveryClose();
      return;
    }
    event.preventDefault();
  });
}

export function installRendererFailureRecovery({
  beforeLoadFailure,
  beforeRendererGone,
  isContentVisible,
  isQuitting,
  reloadAppEntry,
  window,
}: InstallRendererFailureRecoveryArgs): RendererFailureRecovery {
  const recovery = createRendererFailureRecovery(
    window,
    isQuitting,
    isContentVisible,
    beforeLoadFailure,
    reloadAppEntry
  );
  const incidents = createRendererFailureIncidentTracker();

  const snapshotFor = () =>
    collectRendererFailureDiagnostics({ isContentVisible, window });

  installRendererNavigationGuard(window.webContents, {
    onRecoveryClose: () => {
      if (!(window.isDestroyed() || isQuitting())) {
        log.info("recovery-close-via-guard", { windowId: window.id });
        window.destroy();
      }
    },
    onRecoveryReload: () => {
      if (!(window.isDestroyed() || isQuitting())) {
        log.info("recovery-reload-via-guard", { windowId: window.id });
        reloadAppEntry();
      }
    },
  });

  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (
        isMainFrame === false ||
        errorCode === -3 ||
        isQuitting() ||
        window.isDestroyed()
      ) {
        return;
      }
      // Recovery data-URL navigations should not re-enter failure handling.
      if (
        typeof validatedUrl === "string" &&
        validatedUrl.startsWith("data:text/html")
      ) {
        return;
      }
      recovery.report({
        detail: `${errorCode}: ${errorDescription}\n${validatedUrl}`,
        errorCode,
        kind: "load",
      });
    }
  );
  window.webContents.on("render-process-gone", (_event, details) => {
    beforeRendererGone();
    const gone: RendererProcessGoneDetails = {
      exitCode: details.exitCode,
      reason: details.reason,
    };
    const incident = incidents.resolveForProcessGone();
    const snapshot = snapshotFor();
    const quitting = isQuitting();
    const windowDestroyed = window.isDestroyed();
    logRendererProcessGone({
      gone,
      incident,
      isQuitting: quitting,
      snapshot,
      windowDestroyed,
    });
    if (gone.reason === "clean-exit" || quitting || windowDestroyed) {
      return;
    }
    recovery.report({
      detail: formatRendererCrashDetail({
        diagnosticsDir: snapshot.diagnosticsDir,
        exitCode: gone.exitCode,
        forceCrashed: incident.forceCrashed,
        incidentId: incident.incidentId,
        reason: gone.reason,
      }),
      incidentId: incident.incidentId,
      kind: incident.forceCrashed ? "unresponsive" : "crash",
    });
  });
  window.webContents.on("unresponsive", () => {
    if (isQuitting() || window.isDestroyed()) {
      return;
    }
    const incident = incidents.beginUnresponsive();
    const snapshot = snapshotFor();
    log.error(
      "renderer-unresponsive",
      rendererFailureLogCtx(incident, snapshot)
    );
    try {
      // Kill the hung process so we can load a recovery document that the
      // user can interact with (reload / close) without waiting forever.
      // Mark the link only after a successful call so a throw cannot leave a
      // stale pending force-crash that mis-attributes a later process-gone.
      window.webContents.forcefullyCrashRenderer();
      incidents.markForceCrashAttempt(incident.incidentId);
      log.error("renderer-force-crash", {
        incidentId: incident.incidentId,
        windowId: window.id,
      });
    } catch (error) {
      incidents.clearPendingForceCrash();
      log.error("force-crash-failed", {
        incidentId: incident.incidentId,
        message: error instanceof Error ? error.message : String(error),
        windowId: window.id,
      });
      const failed: RendererFailureIncident = {
        ...incident,
        forceCrashed: false,
      };
      recovery.report({
        detail: formatRendererCrashDetail({
          diagnosticsDir: snapshot.diagnosticsDir,
          exitCode: -1,
          forceCrashed: false,
          incidentId: failed.incidentId,
          reason: "unresponsive-force-crash-failed",
        }),
        incidentId: failed.incidentId,
        kind: "unresponsive",
      });
    }
  });
  window.webContents.on("responsive", () => {
    log.info("renderer-responsive", { windowId: window.id });
  });
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    if (isQuitting() || window.isDestroyed()) return;
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    log.error("preload-error", {
      message: message.slice(0, 2000),
      preloadPath,
      windowId: window.id,
    });
    recovery.report({
      detail: `${preloadPath}\n${message}`,
      kind: "preload",
    });
  });
  return recovery;
}
