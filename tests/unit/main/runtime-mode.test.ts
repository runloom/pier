import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDevLaunchEnvHydrationForTests } from "../../../src/main/dev-launch-env.ts";

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
  },
}));

const { isDevRuntime } = await import("../../../src/main/runtime-mode.ts");

const PIER_DEV_EXEC =
  "/repo/.pier-dev/electron-runtime/PierDev.app/Contents/MacOS/PierDev";

describe("isDevRuntime", () => {
  const originalExecPath = process.execPath;
  const originalVite = process.env.NODE_ENV_ELECTRON_VITE;
  const originalRenderer = process.env.ELECTRON_RENDERER_URL;

  afterEach(() => {
    Object.defineProperty(process, "execPath", {
      configurable: true,
      value: originalExecPath,
    });
    if (originalVite === undefined) {
      delete process.env.NODE_ENV_ELECTRON_VITE;
    } else {
      process.env.NODE_ENV_ELECTRON_VITE = originalVite;
    }
    if (originalRenderer === undefined) {
      delete process.env.ELECTRON_RENDERER_URL;
    } else {
      process.env.ELECTRON_RENDERER_URL = originalRenderer;
    }
    resetDevLaunchEnvHydrationForTests();
  });

  it("treats the renamed PierDev shell as a dev runtime even when packaged", () => {
    delete process.env.NODE_ENV_ELECTRON_VITE;
    delete process.env.ELECTRON_RENDERER_URL;
    Object.defineProperty(process, "execPath", {
      configurable: true,
      value: PIER_DEV_EXEC,
    });
    expect(isDevRuntime()).toBe(true);
  });

  it("does not treat a packaged production binary as a dev runtime", () => {
    delete process.env.NODE_ENV_ELECTRON_VITE;
    delete process.env.ELECTRON_RENDERER_URL;
    Object.defineProperty(process, "execPath", {
      configurable: true,
      value: "/Applications/Pier.app/Contents/MacOS/Pier",
    });
    expect(isDevRuntime()).toBe(false);
  });
});
