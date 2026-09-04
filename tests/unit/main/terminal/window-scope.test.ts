import {
  stableWindowIdFor,
  windowRecordIdFor,
  windowRecordIdForElectronWindowId,
} from "@main/ipc/terminal/window-scope.ts";
import type { AppWindow } from "@main/windows/app-window.ts";
import {
  findAppWindowForActivityWindowId,
  forgetAppWindow,
  rememberAppWindow,
} from "@main/windows/identity.ts";
import { describe, expect, it, vi } from "vitest";

const RECORD_UUID = "3f11de0e-6bd9-4281-8c3c-c178cd81f1a0";

function fakeWin(id: number): AppWindow & { markDestroyed: () => void } {
  let destroyed = false;
  return {
    id,
    appView: null,
    close: vi.fn(),
    destroy: vi.fn(),
    focus: vi.fn(),
    getNativeWindowHandle: () => Buffer.from(`handle-${id}`),
    getTitle: vi.fn(() => ""),
    host: {} as AppWindow["host"],
    isDestroyed: () => destroyed,
    isFocused: () => true,
    isMinimized: () => false,
    markDestroyed: () => {
      destroyed = true;
    },
    moveTop: vi.fn(),
    restore: vi.fn(),
    setBackgroundColor: vi.fn(),
    setTitle: vi.fn(),
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

  it("resolves FA windowId as Electron id, not the internal main id", () => {
    const win = fakeWin(1);
    rememberAppWindow(win, {
      electronWindowId: "1",
      mode: "restore",
      recordId: RECORD_UUID,
      windowId: "main",
    });
    try {
      expect(findAppWindowForActivityWindowId("1")).toBe(win);
      expect(findAppWindowForActivityWindowId("main")).toBe(win);
      expect(findAppWindowForActivityWindowId("2")).toBeNull();
    } finally {
      forgetAppWindow(win);
    }
  });

  it("throws for unregistered windows", () => {
    const win = fakeWin(8);
    expect(() => windowRecordIdFor(win)).toThrow("window not registered");
    expect(() => stableWindowIdFor(win)).toThrow("window not registered");
  });

  it("resolves the record id after the BrowserWindow is forgotten", () => {
    const win = fakeWin(7);
    rememberAppWindow(win, {
      electronWindowId: "7",
      mode: "restore",
      recordId: RECORD_UUID,
      windowId: "main",
    });
    expect(windowRecordIdFor(win)).toBe(RECORD_UUID);
    forgetAppWindow(win);
    expect(windowRecordIdForElectronWindowId("7")).toBe(RECORD_UUID);
    expect(windowRecordIdForElectronWindowId(7)).toBe(RECORD_UUID);
  });

  it("falls back to the remembered record id when the window is destroyed", () => {
    const win = fakeWin(9);
    rememberAppWindow(win, {
      electronWindowId: "9",
      mode: "restore",
      recordId: RECORD_UUID,
      windowId: "main",
    });
    expect(windowRecordIdFor(win)).toBe(RECORD_UUID);
    win.markDestroyed();
    expect(windowRecordIdForElectronWindowId("9")).toBe(RECORD_UUID);
    forgetAppWindow(win);
  });
});
