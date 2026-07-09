import type { AppUpdateSnapshot } from "@shared/contracts/app-update.ts";

export interface AppUpdaterAdapter {
  checkForUpdates(): Promise<{ updateInfo?: { version?: string } } | null>;
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
    return setSnapshot({
      currentVersion: options.currentVersion,
      error: err instanceof Error ? err.message : String(err),
      state: "error",
    });
  }

  return {
    async check(): Promise<AppUpdateSnapshot> {
      if (disabled) {
        return setSnapshot({
          currentVersion: options.currentVersion,
          state: "disabled",
        });
      }
      setSnapshot({
        currentVersion: options.currentVersion,
        state: "checking",
      });
      try {
        const result = await options.updater!.checkForUpdates();
        const version = result?.updateInfo?.version;
        return setSnapshot(
          version && version !== options.currentVersion
            ? {
                availableVersion: version,
                currentVersion: options.currentVersion,
                state: "available",
              }
            : {
                currentVersion: options.currentVersion,
                state: "not-available",
              }
        );
      } catch (err) {
        return setError(err);
      }
    },
    async download(): Promise<AppUpdateSnapshot> {
      if (disabled) {
        return setSnapshot({
          currentVersion: options.currentVersion,
          state: "disabled",
        });
      }
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
      }
    },
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
