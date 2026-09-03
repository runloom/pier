import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

const { isDevRuntime } = await import("../../../src/main/runtime-mode.ts");

describe("isDevRuntime without electron.app", () => {
  it("treats a mock that omits app as unpackaged", () => {
    delete process.env.NODE_ENV_ELECTRON_VITE;
    delete process.env.ELECTRON_RENDERER_URL;
    expect(isDevRuntime()).toBe(true);
  });
});
