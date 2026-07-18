import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createAppUpdateService } from "@main/services/app-updates/app-update-service.ts";
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
