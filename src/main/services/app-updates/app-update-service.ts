import type { AppUpdateSnapshot } from "@shared/contracts/app-update.ts";

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
  quitAndInstall(): void;
}

export type AppUpdateRuntimeMode = "development" | "production" | "test";

export interface AppUpdateService {
  check(): Promise<AppUpdateSnapshot>;
  download(): Promise<AppUpdateSnapshot>;
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
    snapshot = next;
    options.onChange?.(snapshot);
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

  function setError(err: unknown): AppUpdateSnapshot {
    // Keep a ready/in-flight package visible across transient check failures.
    if (snapshot.state === "downloaded" || snapshot.state === "downloading") {
      return setSnapshot({
        ...snapshot,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return setSnapshot({
      ...(snapshot.availableVersion
        ? { availableVersion: snapshot.availableVersion }
        : {}),
      currentVersion: options.currentVersion,
      error: err instanceof Error ? err.message : String(err),
      state: "error",
    });
  }

  async function runDownload(): Promise<AppUpdateSnapshot> {
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
        return setError(err);
      } finally {
        downloadInFlight = null;
      }
    })();

    return downloadInFlight;
  }

  async function runCheck(): Promise<AppUpdateSnapshot> {
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
        return await runDownload();
      } catch (err) {
        return setError(err);
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
