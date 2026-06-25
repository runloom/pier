import { describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  appFocus: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    focus: electronMock.appFocus,
  },
}));

import {
  createDetachedDevToolsMenuItem,
  installDetachedDevToolsHandlers,
  isToggleDevToolsInput,
  isToggleDevToolsNativeChord,
  toggleDetachedDevTools,
} from "@main/devtools.ts";

describe("detached DevTools", () => {
  function fakeWindow(isOpen = false) {
    return {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      moveTop: vi.fn(),
      restore: vi.fn(),
      webContents: {
        closeDevTools: vi.fn(),
        isDestroyed: () => false,
        isDevToolsOpened: () => isOpen,
        on: vi.fn(),
        openDevTools: vi.fn(),
      },
    };
  }

  it("opens DevTools in a detached window", () => {
    const win = fakeWindow();

    toggleDetachedDevTools(win);

    expect(win.webContents.openDevTools).toHaveBeenCalledWith({
      activate: true,
      mode: "detach",
      title: "Pier DevTools",
    });
  });

  it("closes DevTools when it is already open", () => {
    const win = fakeWindow(true);

    toggleDetachedDevTools(win);

    expect(win.webContents.closeDevTools).toHaveBeenCalledOnce();
    expect(win.webContents.openDevTools).not.toHaveBeenCalled();
  });

  it("builds a menu item that uses the detached toggle", () => {
    const win = fakeWindow();
    const item = createDetachedDevToolsMenuItem(() => win);

    item.click?.(undefined as never, undefined as never, undefined as never);

    expect(item.role).toBeUndefined();
    expect(item.accelerator).toBe("CommandOrControl+Alt+I");
    expect(win.webContents.openDevTools).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "detach" })
    );
  });

  it("recognizes the webContents devtools accelerator", () => {
    expect(
      isToggleDevToolsInput({
        alt: true,
        code: "KeyI",
        control: false,
        isAutoRepeat: false,
        isComposing: false,
        key: "i",
        location: 0,
        meta: process.platform === "darwin",
        modifiers: [],
        shift: false,
        type: "keyDown",
      })
    ).toBe(process.platform === "darwin");
  });

  it("recognizes the native terminal devtools chord on macOS", () => {
    expect(isToggleDevToolsNativeChord(0x18_00_00, "i")).toBe(
      process.platform === "darwin"
    );
  });

  it("restores focus after DevTools close handling settles", () => {
    vi.useFakeTimers();
    const listeners = new Map<string, (...args: never[]) => void>();
    const win = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      moveTop: vi.fn(),
      restore: vi.fn(),
      webContents: {
        on: vi.fn((event: string, listener: (...args: never[]) => void) => {
          listeners.set(event, listener);
          return win.webContents;
        }),
      },
    };
    const restoreFocus = vi.fn();

    installDetachedDevToolsHandlers(win as never, restoreFocus);
    listeners.get("devtools-closed")?.();

    expect(restoreFocus).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(electronMock.appFocus).toHaveBeenCalledWith({ steal: true });
    expect(win.moveTop).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(restoreFocus).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
