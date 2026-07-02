import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateTerminalInputRouting,
  getLastTerminalInputRoutingSnapshot,
  installTerminalInputRoutingBlurSuppressor,
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
  resetTerminalInputRoutingForTests,
  setTerminalBasePanel,
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

  it("publishes the base panel intent", () => {
    setTerminalBasePanel({
      kind: "terminal",
      panelId: "terminal-1",
    });

    expect(applyInputRouting).toHaveBeenLastCalledWith(
      expect.objectContaining({
        basePanel: { kind: "terminal", panelId: "terminal-1" },
        webOverlayRects: [],
        webRequestCount: 0,
      })
    );
  });

  it("base panel goes into snapshot.basePanel", () => {
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
    expect(getLastTerminalInputRoutingSnapshot()?.basePanel).toEqual({
      kind: "terminal",
      panelId: "terminal-1",
    });
    expect(getLastTerminalInputRoutingSnapshot()?.webRequestCount).toBe(0);
  });

  it("web focus requests increment webRequestCount and release decrements", () => {
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
    const release = requestTerminalWebFocus("search:terminal-1");

    expect(getLastTerminalInputRoutingSnapshot()?.webRequestCount).toBe(1);
    expect(getLastTerminalInputRoutingSnapshot()?.basePanel).toEqual({
      kind: "terminal",
      panelId: "terminal-1",
    });

    release();

    expect(getLastTerminalInputRoutingSnapshot()?.webRequestCount).toBe(0);
  });

  it("multiple web focus requests stay until all released", () => {
    const releaseA = requestTerminalWebFocus("a");
    const releaseB = requestTerminalWebFocus("b");
    expect(getLastTerminalInputRoutingSnapshot()?.webRequestCount).toBe(2);

    releaseA();
    expect(getLastTerminalInputRoutingSnapshot()?.webRequestCount).toBe(1);
    releaseB();
    expect(getLastTerminalInputRoutingSnapshot()?.webRequestCount).toBe(0);
  });

  it("duplicate web focus request is idempotent", () => {
    requestTerminalWebFocus("a");
    requestTerminalWebFocus("a");
    expect(getLastTerminalInputRoutingSnapshot()?.webRequestCount).toBe(1);
  });

  it("terminal focus intent clears all web focus requests", () => {
    setTerminalBasePanel({ kind: "web" });
    requestTerminalWebFocus("stale-dialog");
    requestTerminalWebFocus("stale-popover");

    activateTerminalInputRouting("terminal-1");

    expect(getLastTerminalInputRoutingSnapshot()).toEqual(
      expect.objectContaining({
        basePanel: { kind: "terminal", panelId: "terminal-1" },
        webRequestCount: 0,
      })
    );
    expect(applyInputRouting).toHaveBeenLastCalledWith(
      expect.objectContaining({
        basePanel: { kind: "terminal", panelId: "terminal-1" },
        webRequestCount: 0,
      })
    );
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

describe("terminal→web hand-off transient blur suppression", () => {
  let applyInputRouting: ReturnType<typeof vi.fn>;
  let radixBlurListener: ReturnType<typeof vi.fn<() => void>>;

  const dispatchWindowBlur = () => window.dispatchEvent(new Event("blur"));

  beforeEach(() => {
    resetTerminalInputRoutingForTests();
    applyInputRouting = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        onWindowLayoutPulse: vi.fn(() => vi.fn()),
        terminal: { applyInputRouting },
      },
    });
    installTerminalInputRoutingBlurSuppressor();
    // 模拟 Radix Select/Menu 的 close-on-blur —— 在抑制器之后注册
    radixBlurListener = vi.fn<() => void>();
    window.addEventListener("blur", radixBlurListener);
  });

  afterEach(() => {
    window.removeEventListener("blur", radixBlurListener);
    vi.useRealTimers();
  });

  it("swallows the first blur after an effective terminal→web flip", () => {
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
    requestTerminalWebFocus("pier.click"); // effective: terminal → web

    dispatchWindowBlur();

    expect(radixBlurListener).not.toHaveBeenCalled();
  });

  it("suppression consumes a single blur only", () => {
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
    requestTerminalWebFocus("pier.click");

    dispatchWindowBlur();
    dispatchWindowBlur();

    expect(radixBlurListener).toHaveBeenCalledTimes(1);
  });

  it("does not arm when effective target is already web", () => {
    setTerminalBasePanel({ kind: "web" });
    requestTerminalWebFocus("pier.click"); // web → web, 无 flip

    dispatchWindowBlur();

    expect(radixBlurListener).toHaveBeenCalledTimes(1);
  });

  it("does not arm on web→terminal flips (terminal click must still close menus)", () => {
    setTerminalBasePanel({ kind: "web" });
    activateTerminalInputRouting("terminal-1"); // web → terminal

    dispatchWindowBlur();

    expect(radixBlurListener).toHaveBeenCalledTimes(1);
  });

  it("arm expires after the hand-off window", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
    requestTerminalWebFocus("pier.click");

    vi.advanceTimersByTime(400);
    dispatchWindowBlur();

    expect(radixBlurListener).toHaveBeenCalledTimes(1);
  });
});
