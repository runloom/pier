import {
  clearTerminalFocusWindow,
  focusWebContentsForEffectiveInputRouting,
} from "@main/ipc/terminal-focus-state.ts";
import type { AppWindow } from "@main/windows/app-window.ts";
import type { TerminalNativeInputRoutingSnapshot } from "@shared/contracts/terminal.ts";
import { describe, expect, it, vi } from "vitest";

function mockWindow(focused: boolean): AppWindow {
  return {
    id: 1,
    webContents: {
      isDestroyed: () => false,
      isFocused: () => focused,
      focus: vi.fn(),
    },
  } as unknown as AppWindow;
}

function webTarget(): TerminalNativeInputRoutingSnapshot {
  return {
    keyboardFocusTarget: { kind: "web" },
    nativeApplySequence: 1,
    rendererSequence: 1,
    webOverlayRects: [],
    windowFocused: true,
  };
}

function terminalTarget(): TerminalNativeInputRoutingSnapshot {
  return {
    keyboardFocusTarget: { kind: "terminal", panelId: "p1" },
    nativeApplySequence: 2,
    rendererSequence: 2,
    webOverlayRects: [],
    windowFocused: true,
  };
}

describe("focusWebContentsForEffectiveInputRouting", () => {
  it("calls focus when target switches to web and webContents is not focused", () => {
    const win = mockWindow(false);
    clearTerminalFocusWindow(win);
    focusWebContentsForEffectiveInputRouting(win, webTarget(), "test");
    expect(win.webContents.focus).toHaveBeenCalledOnce();
  });

  it("does not call focus when webContents already focused", () => {
    const win = mockWindow(true);
    clearTerminalFocusWindow(win);
    focusWebContentsForEffectiveInputRouting(win, webTarget(), "test");
    expect(win.webContents.focus).not.toHaveBeenCalled();
  });

  it("does not call focus when target is terminal", () => {
    const win = mockWindow(false);
    clearTerminalFocusWindow(win);
    focusWebContentsForEffectiveInputRouting(win, terminalTarget(), "test");
    expect(win.webContents.focus).not.toHaveBeenCalled();
  });

  it("does not call focus again when target stays web and already focused", () => {
    const win = mockWindow(true);
    clearTerminalFocusWindow(win);
    focusWebContentsForEffectiveInputRouting(win, webTarget(), "test");
    focusWebContentsForEffectiveInputRouting(win, webTarget(), "test");
    expect(win.webContents.focus).not.toHaveBeenCalled();
  });

  it("does not call focus for terminal-window-focus reason if webContents already focused", () => {
    const win = mockWindow(true);
    clearTerminalFocusWindow(win);
    focusWebContentsForEffectiveInputRouting(win, webTarget(), "test");
    focusWebContentsForEffectiveInputRouting(
      win,
      webTarget(),
      "terminal-window-focus"
    );
    expect(win.webContents.focus).not.toHaveBeenCalled();
  });
});
