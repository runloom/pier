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

  it("checks for production updates and records the available version", async () => {
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      runtimeMode: "production",
      updater: {
        checkForUpdates: vi.fn(async () => ({
          updateInfo: { version: "0.2.0" },
        })),
        downloadUpdate: vi.fn(),
        on: vi.fn(),
        quitAndInstall: vi.fn(),
      },
    });

    await expect(service.check()).resolves.toMatchObject({
      availableVersion: "0.2.0",
      currentVersion: "0.1.0",
      state: "available",
    });
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

    await service.check();
    await expect(service.download()).resolves.toMatchObject({
      availableVersion: "0.2.0",
      state: "downloaded",
    });
    service.quitAndInstall();

    expect(quitAndInstall).toHaveBeenCalledTimes(1);
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
    await service.download();

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
  });
});
