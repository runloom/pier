import {
  stableWindowIdFor,
  windowRecordIdFor,
} from "@main/ipc/terminal-window-scope.ts";
import type { AppWindow } from "@main/windows/app-window.ts";
import {
  forgetAppWindow,
  rememberAppWindow,
} from "@main/windows/window-identity.ts";
import { describe, expect, it, vi } from "vitest";

const RECORD_UUID = "3f11de0e-6bd9-4281-8c3c-c178cd81f1a0";

function fakeWin(id: number): AppWindow {
  return {
    id,
    appView: null,
    close: vi.fn(),
    destroy: vi.fn(),
    focus: vi.fn(),
    getNativeWindowHandle: () => Buffer.from(`handle-${id}`),
    host: {} as AppWindow["host"],
    isDestroyed: () => false,
    isFocused: () => true,
    isMinimized: () => false,
    moveTop: vi.fn(),
    restore: vi.fn(),
    setBackgroundColor: vi.fn(),
    webContents: {} as AppWindow["webContents"],
  };
}

describe("terminal window scope", () => {
  it("windowRecordIdFor returns the persistent record UUID, not the runtime id", () => {
    // Regression: session persistence and panel-transfer must share one key
    // space. Historically this returned "main"/"w-1" (runtime id) while
    // transfer resolved record UUIDs → "source panel missing" on every
    // terminal drag.
    const win = fakeWin(7);
    rememberAppWindow(win, {
      electronWindowId: "7",
      mode: "restore",
      recordId: RECORD_UUID,
      windowId: "main",
    });
    try {
      expect(windowRecordIdFor(win)).toBe(RECORD_UUID);
      expect(stableWindowIdFor(win)).toBe("main");
    } finally {
      forgetAppWindow(win);
    }
  });

  it("throws for unregistered windows", () => {
    const win = fakeWin(8);
    expect(() => windowRecordIdFor(win)).toThrow("window not registered");
    expect(() => stableWindowIdFor(win)).toThrow("window not registered");
  });
});
