import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLastTerminalInputRoutingSnapshot,
  hasExclusiveWebFocusScope,
  registerTerminalFullscreenWebOverlay,
  registerWebFocusScope,
  releaseTransientWebFocusScopes,
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

  it("lets exclusive Web focus scope override and restore the base target", () => {
    setTerminalBaseKeyboardFocusTarget({
      kind: "terminal",
      panelId: "terminal-1",
    });
    const release = registerWebFocusScope("dialog", "exclusive");

    expect(getLastTerminalInputRoutingSnapshot()?.keyboardFocusTarget).toEqual({
      kind: "web",
      scope: "exclusive",
    });

    release();

    expect(getLastTerminalInputRoutingSnapshot()?.keyboardFocusTarget).toEqual({
      kind: "terminal",
      panelId: "terminal-1",
    });
  });

  it("releases only transient Web focus scopes", () => {
    setTerminalBaseKeyboardFocusTarget({
      kind: "terminal",
      panelId: "terminal-1",
    });
    const releaseDialog = registerWebFocusScope("dialog", "exclusive");
    registerWebFocusScope("search-input", "transient");

    releaseTransientWebFocusScopes();

    expect(getLastTerminalInputRoutingSnapshot()?.keyboardFocusTarget).toEqual({
      kind: "web",
      scope: "exclusive",
    });

    releaseDialog();

    expect(getLastTerminalInputRoutingSnapshot()?.keyboardFocusTarget).toEqual({
      kind: "terminal",
      panelId: "terminal-1",
    });
  });

  it("hasExclusiveWebFocusScope returns true only with exclusive scope", () => {
    resetTerminalInputRoutingForTests();
    expect(hasExclusiveWebFocusScope()).toBe(false);
    const release = registerWebFocusScope("dialog", "exclusive");
    expect(hasExclusiveWebFocusScope()).toBe(true);
    release();
    expect(hasExclusiveWebFocusScope()).toBe(false);
  });

  it("exclusive scope wins over transient scopes", () => {
    resetTerminalInputRoutingForTests();
    registerWebFocusScope("menu", "transient");
    registerWebFocusScope("dialog", "exclusive");

    expect(getLastTerminalInputRoutingSnapshot()?.keyboardFocusTarget).toEqual({
      kind: "web",
      scope: "exclusive",
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
