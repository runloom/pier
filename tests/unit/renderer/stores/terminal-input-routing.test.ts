import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLastTerminalInputRoutingSnapshot,
  holdTerminalWebKeyboardFocus,
  registerTerminalFullscreenWebOverlay,
  releaseTransientTerminalWebKeyboardFocus,
  resetTerminalInputRoutingForTests,
  setTerminalBaseKeyboardFocusTarget,
} from "@/stores/terminal-input-routing.store.ts";

describe("terminal input routing store", () => {
  let applyInputRouting: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetTerminalInputRoutingForTests();
    applyInputRouting = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        onWindowLayoutPulse: vi.fn(() => vi.fn()),
        terminal: {
          applyInputRouting,
        },
      },
    });
  });

  it("publishes a terminal keyboard target", () => {
    setTerminalBaseKeyboardFocusTarget({
      kind: "terminal",
      panelId: "terminal-1",
    });

    expect(applyInputRouting).toHaveBeenLastCalledWith(
      expect.objectContaining({
        keyboardFocusTarget: { kind: "terminal", panelId: "terminal-1" },
        webOverlayRects: [],
      })
    );
  });

  it("lets Web keyboard owners override and restore the base target", () => {
    setTerminalBaseKeyboardFocusTarget({
      kind: "terminal",
      panelId: "terminal-1",
    });
    const release = holdTerminalWebKeyboardFocus("dialog");

    expect(getLastTerminalInputRoutingSnapshot()?.keyboardFocusTarget).toEqual({
      kind: "web",
    });

    release();

    expect(getLastTerminalInputRoutingSnapshot()?.keyboardFocusTarget).toEqual({
      kind: "terminal",
      panelId: "terminal-1",
    });
  });

  it("releases only transient Web keyboard owners", () => {
    setTerminalBaseKeyboardFocusTarget({
      kind: "terminal",
      panelId: "terminal-1",
    });
    const releaseDialog = holdTerminalWebKeyboardFocus("dialog");
    holdTerminalWebKeyboardFocus("search-input", { transient: true });

    releaseTransientTerminalWebKeyboardFocus();

    expect(getLastTerminalInputRoutingSnapshot()?.keyboardFocusTarget).toEqual({
      kind: "web",
    });

    releaseDialog();

    expect(getLastTerminalInputRoutingSnapshot()?.keyboardFocusTarget).toEqual({
      kind: "terminal",
      panelId: "terminal-1",
    });
  });

  it("registers and disposes a fullscreen Web overlay rect", () => {
    const registration = registerTerminalFullscreenWebOverlay("dialog");

    expect(getLastTerminalInputRoutingSnapshot()?.webOverlayRects).toHaveLength(
      1
    );

    registration.dispose();

    expect(getLastTerminalInputRoutingSnapshot()?.webOverlayRects).toHaveLength(
      0
    );
  });
});
