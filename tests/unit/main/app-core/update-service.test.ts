import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { classifyAppUpdateError } from "@main/services/app-updates/error-kind.ts";
import { createAppUpdateService } from "@main/services/app-updates/service.ts";
import { describe, expect, it, vi } from "vitest";

describe("AppUpdateService", () => {
  it("is disabled in development runtime", async () => {
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      runtimeMode: "development",
    });

    await expect(service.check()).resolves.toMatchObject({
      currentVersion: "0.1.0",
      state: "disabled",
    });
  });

  it("checks for production updates and auto-downloads when available", async () => {
    const downloadUpdate = vi.fn(async () => []);
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      runtimeMode: "production",
      updater: {
        checkForUpdates: vi.fn(async () => ({
          updateInfo: { version: "0.2.0" },
        })),
        downloadUpdate,
        on: vi.fn(),
        quitAndInstall: vi.fn(),
      },
    });

    await expect(service.check()).resolves.toMatchObject({
      availableVersion: "0.2.0",
      currentVersion: "0.1.0",
      state: "downloaded",
    });
    expect(downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("records not-available without downloading", async () => {
    const downloadUpdate = vi.fn(async () => []);
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      runtimeMode: "production",
      updater: {
        checkForUpdates: vi.fn(async () => ({
          updateInfo: { version: "0.1.0" },
        })),
        downloadUpdate,
        on: vi.fn(),
        quitAndInstall: vi.fn(),
      },
    });

    await expect(service.check()).resolves.toMatchObject({
      currentVersion: "0.1.0",
      state: "not-available",
    });
    expect(downloadUpdate).not.toHaveBeenCalled();
  });

  it("honors isUpdateAvailable false even when updateInfo version differs", async () => {
    const downloadUpdate = vi.fn(async () => []);
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      runtimeMode: "production",
      updater: {
        checkForUpdates: vi.fn(async () => ({
          isUpdateAvailable: false,
          updateInfo: { version: "0.2.0" },
        })),
        downloadUpdate,
        on: vi.fn(),
        quitAndInstall: vi.fn(),
      },
    });

    await expect(service.check()).resolves.toMatchObject({
      currentVersion: "0.1.0",
      state: "not-available",
    });
    expect(downloadUpdate).not.toHaveBeenCalled();
  });

  it("preserves downloaded state across later checks", async () => {
    const checkForUpdates = vi
      .fn()
      .mockResolvedValueOnce({
        isUpdateAvailable: true,
        updateInfo: { version: "0.2.0" },
      })
      .mockResolvedValueOnce({
        isUpdateAvailable: true,
        updateInfo: { version: "0.2.0" },
      });
    const downloadUpdate = vi.fn(async () => []);
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      runtimeMode: "production",
      updater: {
        checkForUpdates,
        downloadUpdate,
        on: vi.fn(),
        quitAndInstall: vi.fn(),
      },
    });

    await expect(service.check()).resolves.toMatchObject({
      state: "downloaded",
    });
    await expect(service.check()).resolves.toMatchObject({
      availableVersion: "0.2.0",
      state: "downloaded",
    });
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    expect(downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("single-flights concurrent checks", async () => {
    let releaseCheck: (() => void) | undefined;
    const checkForUpdates = vi.fn(
      () =>
        new Promise<{ updateInfo: { version: string } }>((resolve) => {
          releaseCheck = () => resolve({ updateInfo: { version: "0.2.0" } });
        })
    );
    const downloadUpdate = vi.fn(async () => []);
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      runtimeMode: "production",
      updater: {
        checkForUpdates,
        downloadUpdate,
        on: vi.fn(),
        quitAndInstall: vi.fn(),
      },
    });

    const first = service.check();
    const second = service.check();
    releaseCheck?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ state: "downloaded" }),
      expect.objectContaining({ state: "downloaded" }),
    ]);
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    expect(downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("downloads an available update and delegates quitAndInstall", async () => {
    const quitAndInstall = vi.fn();
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      runtimeMode: "production",
      updater: {
        checkForUpdates: vi.fn(async () => ({
          updateInfo: { version: "0.2.0" },
        })),
        downloadUpdate: vi.fn(async () => []),
        on: vi.fn(),
        quitAndInstall,
      },
    });

    await expect(service.check()).resolves.toMatchObject({
      availableVersion: "0.2.0",
      state: "downloaded",
    });
    service.quitAndInstall();

    expect(quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("does not quitAndInstall before download completes", async () => {
    const quitAndInstall = vi.fn();
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      runtimeMode: "production",
      updater: {
        checkForUpdates: vi.fn(async () => null),
        downloadUpdate: vi.fn(async () => []),
        on: vi.fn(),
        quitAndInstall,
      },
    });

    await service.check();
    service.quitAndInstall();
    expect(quitAndInstall).not.toHaveBeenCalled();
  });

  it("fires onReady once when entering downloaded (not on later status)", async () => {
    const onReady = vi.fn();
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      onReady,
      runtimeMode: "production",
      updater: {
        checkForUpdates: vi.fn(async () => ({
          isUpdateAvailable: true,
          updateInfo: { version: "0.2.0" },
        })),
        downloadUpdate: vi.fn(async () => []),
        on: vi.fn(),
        quitAndInstall: vi.fn(),
      },
    });

    await service.check();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith("0.2.0");
    // already downloaded: check is a no-op edge
    await service.check();
    expect(onReady).toHaveBeenCalledTimes(1);
    // download short-circuits without re-notifying
    await service.download();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("notifies listeners when download progress and completion change", async () => {
    let progressListener:
      | ((progress: { percent?: number }) => void)
      | undefined;
    const onChange = vi.fn();
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      onChange,
      runtimeMode: "production",
      updater: {
        checkForUpdates: vi.fn(async () => ({
          updateInfo: { version: "0.2.0" },
        })),
        downloadUpdate: vi.fn(async () => {
          progressListener?.({ percent: 42 });
          return [];
        }),
        on: vi.fn((event, cb) => {
          if (event === "download-progress") {
            progressListener = cb;
          }
        }),
        quitAndInstall: vi.fn(),
      },
    });

    await service.check();

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        progress: { percent: 42 },
        state: "downloading",
      })
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "downloaded" })
    );
  });

  it("download failure leaves retryable error with availableVersion", async () => {
    const downloadUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error("net::ERR_CONNECTION_RESET"));
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      runtimeMode: "production",
      updater: {
        checkForUpdates: vi.fn(async () => ({
          isUpdateAvailable: true,
          updateInfo: { version: "0.2.0" },
        })),
        downloadUpdate,
        on: vi.fn(),
        quitAndInstall: vi.fn(),
      },
    });

    await expect(service.check()).resolves.toMatchObject({
      availableVersion: "0.2.0",
      errorDetail: "net::ERR_CONNECTION_RESET",
      errorKind: "offline",
      state: "error",
    });
    expect(service.getStatus().progress).toBeUndefined();
    expect(downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("allows re-download after a failed download", async () => {
    const downloadUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error("net::ERR_CONNECTION_RESET"))
      .mockResolvedValueOnce([]);
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      runtimeMode: "production",
      updater: {
        checkForUpdates: vi.fn(async () => ({
          isUpdateAvailable: true,
          updateInfo: { version: "0.2.0" },
        })),
        downloadUpdate,
        on: vi.fn(),
        quitAndInstall: vi.fn(),
      },
    });

    await expect(service.check()).resolves.toMatchObject({ state: "error" });
    await expect(service.download()).resolves.toMatchObject({
      availableVersion: "0.2.0",
      state: "downloaded",
    });
    expect(service.getStatus().errorDetail).toBeUndefined();
    expect(downloadUpdate).toHaveBeenCalledTimes(2);
  });

  it("allows check to run again after a failed download", async () => {
    const checkForUpdates = vi
      .fn()
      .mockResolvedValueOnce({
        isUpdateAvailable: true,
        updateInfo: { version: "0.2.0" },
      })
      .mockResolvedValueOnce({
        isUpdateAvailable: true,
        updateInfo: { version: "0.2.0" },
      });
    const downloadUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error("net::ERR_CONNECTION_RESET"))
      .mockResolvedValueOnce([]);
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      runtimeMode: "production",
      updater: {
        checkForUpdates,
        downloadUpdate,
        on: vi.fn(),
        quitAndInstall: vi.fn(),
      },
    });

    await expect(service.check()).resolves.toMatchObject({ state: "error" });
    await expect(service.check()).resolves.toMatchObject({
      availableVersion: "0.2.0",
      state: "downloaded",
    });
    expect(checkForUpdates).toHaveBeenCalledTimes(2);
    expect(downloadUpdate).toHaveBeenCalledTimes(2);
  });

  it("reports error kind and trigger origin through onError", async () => {
    const checkForUpdates = vi
      .fn()
      .mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED"));
    const onError = vi.fn();
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      onError,
      runtimeMode: "production",
      updater: {
        checkForUpdates,
        downloadUpdate: vi.fn(),
        on: vi.fn(),
        quitAndInstall: vi.fn(),
      },
    });

    await service.check();
    expect(onError).toHaveBeenCalledWith({
      detail: "net::ERR_INTERNET_DISCONNECTED",
      kind: "offline",
      origin: "user",
    });

    onError.mockClear();
    await service.check("background");
    expect(onError).toHaveBeenCalledWith({
      detail: "net::ERR_INTERNET_DISCONNECTED",
      kind: "offline",
      origin: "background",
    });
  });

  it("keeps a ready package installable when an error event arrives later", async () => {
    let errorListener:
      | ((payload: { percent?: number } | Error) => void)
      | undefined;
    const onError = vi.fn();
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      onError,
      runtimeMode: "production",
      updater: {
        checkForUpdates: vi.fn(async () => ({
          isUpdateAvailable: true,
          updateInfo: { version: "0.2.0" },
        })),
        downloadUpdate: vi.fn(async () => []),
        on: vi.fn(
          (
            event: "download-progress" | "error",
            cb: (payload: { percent?: number } | Error) => void
          ) => {
            if (event === "error") {
              errorListener = cb;
            }
          }
        ),
        quitAndInstall: vi.fn(),
      },
    });

    await expect(service.check()).resolves.toMatchObject({
      state: "downloaded",
    });
    errorListener?.(new Error("503 Service Unavailable"));
    expect(service.getStatus()).toMatchObject({
      availableVersion: "0.2.0",
      errorDetail: "503 Service Unavailable",
      errorKind: "server",
      state: "downloaded",
    });
    // Ready package is installable; the failed re-check must not demote it.
    expect(onError).not.toHaveBeenCalled();
  });

  it("maps out-of-band error events through the same error path", async () => {
    let errorListener:
      | ((payload: { percent?: number } | Error) => void)
      | undefined;
    const onError = vi.fn();
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      onError,
      runtimeMode: "production",
      updater: {
        checkForUpdates: vi.fn(async () => ({
          isUpdateAvailable: false,
          updateInfo: { version: "0.1.0" },
        })),
        downloadUpdate: vi.fn(),
        on: vi.fn(
          (
            event: "download-progress" | "error",
            cb: (payload: { percent?: number } | Error) => void
          ) => {
            if (event === "error") {
              errorListener = cb;
            }
          }
        ),
        quitAndInstall: vi.fn(),
      },
    });

    await expect(service.check()).resolves.toMatchObject({
      state: "not-available",
    });
    errorListener?.(new Error("502 Bad Gateway"));
    expect(service.getStatus()).toMatchObject({
      errorDetail: "502 Bad Gateway",
      errorKind: "server",
      state: "error",
    });
    expect(onError).toHaveBeenCalledWith({
      detail: "502 Bad Gateway",
      kind: "server",
      origin: "background",
    });
  });

  it("ignores error events while a download is in flight", async () => {
    let releaseDownload: (() => void) | undefined;
    let errorListener:
      | ((payload: { percent?: number } | Error) => void)
      | undefined;
    const onError = vi.fn();
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      onError,
      runtimeMode: "production",
      updater: {
        checkForUpdates: vi.fn(async () => ({
          isUpdateAvailable: true,
          updateInfo: { version: "0.2.0" },
        })),
        downloadUpdate: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseDownload = resolve;
            })
        ),
        on: vi.fn(
          (
            event: "download-progress" | "error",
            cb: (payload: { percent?: number } | Error) => void
          ) => {
            if (event === "error") {
              errorListener = cb;
            }
          }
        ),
        quitAndInstall: vi.fn(),
      },
    });

    const checkPromise = service.check();
    await vi.waitFor(() => {
      expect(service.getStatus().state).toBe("downloading");
    });

    errorListener?.(new Error("502 Bad Gateway"));
    expect(service.getStatus()).toMatchObject({ state: "downloading" });
    expect(onError).not.toHaveBeenCalled();

    releaseDownload?.();
    await expect(checkPromise).resolves.toMatchObject({ state: "downloaded" });
  });

  it("imports electron-updater through default CommonJS interop", async () => {
    const source = await readFile(
      join(
        process.cwd(),
        "src/main/services/app-updates/electron-updater-adapter.ts"
      ),
      "utf8"
    );

    expect(source).not.toMatch(
      /import\s*\{\s*autoUpdater\s*\}\s*from\s*["']electron-updater["']/
    );
    expect(source).toMatch(/import\s+\w+\s+from\s*["']electron-updater["']/);
    expect(source).toMatch(/autoDownload\s*=\s*false/);
    expect(source).toMatch(/autoInstallOnAppQuit\s*=\s*true/);
  });
});

describe("classifyAppUpdateError", () => {
  it.each([
    ["net::ERR_INTERNET_DISCONNECTED", "offline"],
    ["net::ERR_NAME_NOT_RESOLVED", "offline"],
    ["getaddrinfo ENOTFOUND api.github.com", "offline"],
    ["Error: connect ECONNREFUSED 127.0.0.1:443", "offline"],
    ["502 Bad Gateway", "server"],
    ["HttpError: 503 Service Unavailable", "server"],
    ["403 rate limit exceeded", "rate-limited"],
    ["429 Too Many Requests", "rate-limited"],
    [
      "Cannot find latest-mac.yml in the latest release artifacts (…): 404",
      "no-artifact",
    ],
    ["No published versions on GitHub", "no-artifact"],
    ["something unexpected", "unknown"],
  ])("classifies %j → %j", (message, expected) => {
    expect(classifyAppUpdateError(new Error(message))).toBe(expected);
  });

  it("prefers the error code for node-style failures", () => {
    const err = Object.assign(new Error("request failed"), {
      code: "ENOTFOUND",
    });
    expect(classifyAppUpdateError(err)).toBe("offline");
  });

  it("falls back to unknown for empty input", () => {
    expect(classifyAppUpdateError(undefined)).toBe("unknown");
  });
});
