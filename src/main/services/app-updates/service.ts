import type {
  AppUpdateErrorKind,
  AppUpdateSnapshot,
} from "@shared/contracts/app-update.ts";
import { classifyAppUpdateError } from "./error-kind.ts";

export interface AppUpdaterCheckResult {
  readonly isUpdateAvailable?: boolean;
  readonly updateInfo?: { version?: string };
}

export interface AppUpdaterAdapter {
  checkForUpdates(): Promise<AppUpdaterCheckResult | null>;
  downloadUpdate(): Promise<unknown>;
  on(
    event: "download-progress",
    cb: (progress: { percent?: number }) => void
  ): void;
  on(event: "error", cb: (err: Error) => void): void;
  quitAndInstall(): void;
}

export type AppUpdateRuntimeMode = "development" | "production" | "test";

export type AppUpdateTrigger = "user" | "background";

export interface AppUpdateService {
  check(trigger?: AppUpdateTrigger): Promise<AppUpdateSnapshot>;
  download(trigger?: AppUpdateTrigger): Promise<AppUpdateSnapshot>;
  getStatus(): AppUpdateSnapshot;
  quitAndInstall(): void;
}

function resolveAvailableVersion(
  result: AppUpdaterCheckResult | null | undefined,
  currentVersion: string
): string | null {
  const version = result?.updateInfo?.version;
  if (!version || version === currentVersion) {
    return null;
  }
  // electron-updater always returns updateInfo; isUpdateAvailable is the real gate.
  if (result?.isUpdateAvailable === false) {
    return null;
  }
  if (result?.isUpdateAvailable === true) {
    return version;
  }
  // Adapters/tests that omit the flag still work via version inequality.
  return version;
}

export function createAppUpdateService(options: {
  readonly currentVersion: string;
  readonly onChange?: (snapshot: AppUpdateSnapshot) => void;
  /**
   * Fired once per process when state crosses into `downloaded` with a version.
   * Host wires this to NCS (process-level single notify; not per-window mirror).
   */
  readonly onReady?: (version: string) => void;
  /**
   * Fired when a check/download lands in the retryable `error` state.
   * Host wires origin==="background" failures to NCS; user-origin failures
   * surface inline in Settings. Not fired when a ready package merely
   * survives a later failed check.
   */
  readonly onError?: (err: {
    readonly detail: string;
    readonly kind: AppUpdateErrorKind;
    readonly origin: AppUpdateTrigger;
  }) => void;
  readonly runtimeMode: AppUpdateRuntimeMode;
  readonly updater?: AppUpdaterAdapter;
}): AppUpdateService {
  const disabled = options.runtimeMode !== "production" || !options.updater;
  let snapshot: AppUpdateSnapshot = {
    currentVersion: options.currentVersion,
    state: disabled ? "disabled" : "idle",
  };
  let checkInFlight: Promise<AppUpdateSnapshot> | null = null;
  let downloadInFlight: Promise<AppUpdateSnapshot> | null = null;

  function setSnapshot(next: AppUpdateSnapshot): AppUpdateSnapshot {
    const prevState = snapshot.state;
    snapshot = next;
    options.onChange?.(snapshot);
    if (
      prevState !== "downloaded" &&
      next.state === "downloaded" &&
      next.availableVersion
    ) {
      options.onReady?.(next.availableVersion);
    }
    return snapshot;
  }

  options.updater?.on("download-progress", (progress) => {
    if (snapshot.state !== "downloading") {
      return;
    }
    setSnapshot({
      ...snapshot,
      progress: { percent: progress.percent ?? 0 },
    });
  });
  // Promise paths own in-flight check/download failures; the event bus covers
  // out-of-band failures (e.g. install phase). Never double-handle a failure
  // the in-flight promise will also report.
  options.updater?.on("error", (err) => {
    if (snapshot.state === "downloading" || snapshot.state === "checking") {
      return;
    }
    setError(err, "background");
  });

  function setError(err: unknown, origin: AppUpdateTrigger): AppUpdateSnapshot {
    const message = err instanceof Error ? err.message : String(err);
    const kind = classifyAppUpdateError(err);
    // Ready package stays installable if a later check fails.
    if (snapshot.state === "downloaded") {
      return setSnapshot({
        ...snapshot,
        errorDetail: message,
        errorKind: kind,
      });
    }
    // Download failed (or check failed): leave a retryable error so the UI can
    // re-check / re-download. Do not stay on `downloading` — that disables both
    // Download and Check (check early-returns while state is downloading).
    // A late duplicate of an already-recorded failure (e.g. the updater event
    // bus echoing a settled promise rejection) must not re-report to NCS.
    const duplicate =
      snapshot.state === "error" && snapshot.errorDetail === message;
    const next = setSnapshot({
      ...(snapshot.availableVersion
        ? { availableVersion: snapshot.availableVersion }
        : {}),
      currentVersion: options.currentVersion,
      errorDetail: message,
      errorKind: kind,
      state: "error",
    });
    if (!duplicate) {
      options.onError?.({ detail: message, kind, origin });
    }
    return next;
  }

  async function runDownload(
    trigger: AppUpdateTrigger = "user"
  ): Promise<AppUpdateSnapshot> {
    if (disabled) {
      return setSnapshot({
        currentVersion: options.currentVersion,
        state: "disabled",
      });
    }
    if (snapshot.state === "downloaded") {
      return snapshot;
    }
    if (downloadInFlight) {
      return downloadInFlight;
    }

    downloadInFlight = (async () => {
      const availableVersion = snapshot.availableVersion;
      setSnapshot({
        ...(availableVersion ? { availableVersion } : {}),
        currentVersion: options.currentVersion,
        progress: { percent: 0 },
        state: "downloading",
      });
      try {
        await options.updater!.downloadUpdate();
        return setSnapshot({
          ...(availableVersion ? { availableVersion } : {}),
          currentVersion: options.currentVersion,
          state: "downloaded",
        });
      } catch (err) {
        return setError(err, trigger);
      } finally {
        downloadInFlight = null;
      }
    })();

    return downloadInFlight;
  }

  async function runCheck(
    trigger: AppUpdateTrigger = "user"
  ): Promise<AppUpdateSnapshot> {
    if (disabled) {
      return setSnapshot({
        currentVersion: options.currentVersion,
        state: "disabled",
      });
    }
    // Do not demote a ready or in-flight download for background re-checks.
    if (snapshot.state === "downloaded" || snapshot.state === "downloading") {
      return snapshot;
    }
    if (checkInFlight) {
      return checkInFlight;
    }

    checkInFlight = (async () => {
      setSnapshot({
        currentVersion: options.currentVersion,
        state: "checking",
      });
      try {
        const result = await options.updater!.checkForUpdates();
        const version = resolveAvailableVersion(result, options.currentVersion);
        if (!version) {
          return setSnapshot({
            currentVersion: options.currentVersion,
            state: "not-available",
          });
        }

        setSnapshot({
          availableVersion: version,
          currentVersion: options.currentVersion,
          state: "available",
        });
        // Production path: discover then background-download. Install stays manual.
        return await runDownload(trigger);
      } catch (err) {
        return setError(err, trigger);
      } finally {
        checkInFlight = null;
      }
    })();

    return checkInFlight;
  }

  return {
    check: runCheck,
    download: runDownload,
    getStatus(): AppUpdateSnapshot {
      return snapshot;
    },
    quitAndInstall(): void {
      if (!disabled && snapshot.state === "downloaded") {
        options.updater!.quitAndInstall();
      }
    },
  };
}
