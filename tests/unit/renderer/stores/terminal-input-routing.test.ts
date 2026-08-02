import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLastTerminalHostSnapshot } from "@/lib/workspace/terminal-host-state-reconciler.ts";
import {
  beginTerminalPanelWebDragCapture,
  getTerminalFocusRoutingDebugSnapshot,
  installTerminalInputRoutingBlurSuppressor,
  registerTerminalFullscreenWebOverlay,
  requestTerminalFocusIntent,
  requestTerminalWebFocus,
  resetTerminalInputRoutingForTests,
  setTerminalBasePanel,
} from "@/stores/terminal-input-routing-slice.ts";

describe("terminal input routing store", () => {
  let applyHostSnapshot: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetTerminalInputRoutingForTests();
    applyHostSnapshot = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        onWindowLayoutPulse: vi.fn(() => vi.fn()),
        terminal: {
          applyHostSnapshot,
        },
      },
    });
  });

  it("publishes the base panel intent", () => {
    setTerminalBasePanel({
      kind: "terminal",
      panelId: "terminal-1",
    });

    expect(applyHostSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        basePanel: { kind: "terminal", panelId: "terminal-1" },
        webOverlayRects: [],
        webRequestCount: 0,
      })
    );
  });

  it("republishes unchanged terminal intent after a tab click", () => {
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
    const firstSequence = getLastTerminalHostSnapshot()?.rendererSequence;
    applyHostSnapshot.mockClear();

    requestTerminalFocusIntent("terminal-1");

    expect(applyHostSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        basePanel: { kind: "terminal", panelId: "terminal-1" },
        rendererSequence: (firstSequence ?? 0) + 1,
      })
    );
  });
  it("clears only transient click ownership for terminal intent", () => {
    setTerminalBasePanel({ kind: "web" });
    requestTerminalWebFocus("pier.click");
    requestTerminalWebFocus("dialog");

    requestTerminalFocusIntent("terminal-1");

    expect(getLastTerminalHostSnapshot()).toEqual(
      expect.objectContaining({
        basePanel: { kind: "terminal", panelId: "terminal-1" },
        webRequestCount: 1,
      })
    );
  });

  it("exposes webRequestIds (not only count) for debug dumps", () => {
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
    const releaseA = requestTerminalWebFocus("a");
    requestTerminalWebFocus("pier.click");
    expect(getTerminalFocusRoutingDebugSnapshot().webRequestIds).toEqual([
      "a",
      "pier.click",
    ]);
    releaseA();
    expect(getTerminalFocusRoutingDebugSnapshot().webRequestIds).toEqual([
      "pier.click",
    ]);
  });

  it("base panel goes into snapshot.basePanel", () => {
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
    expect(getLastTerminalHostSnapshot()?.basePanel).toEqual({
      kind: "terminal",
      panelId: "terminal-1",
    });
    expect(getLastTerminalHostSnapshot()?.webRequestCount).toBe(0);
  });

  it("web focus requests increment webRequestCount and release decrements", () => {
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
    const release = requestTerminalWebFocus("search:terminal-1");

    expect(getLastTerminalHostSnapshot()?.webRequestCount).toBe(1);
    expect(getLastTerminalHostSnapshot()?.basePanel).toEqual({
      kind: "terminal",
      panelId: "terminal-1",
    });

    release();

    expect(getLastTerminalHostSnapshot()?.webRequestCount).toBe(0);
  });

  it("multiple web focus requests stay until all released", async () => {
    const releaseA = requestTerminalWebFocus("a");
    const releaseB = requestTerminalWebFocus("b");
    expect(getLastTerminalHostSnapshot()?.webRequestCount).toBe(2);

    releaseA();
    expect(getLastTerminalHostSnapshot()?.webRequestCount).toBe(1);
    releaseB();
    expect(getLastTerminalHostSnapshot()?.webRequestCount).toBe(0);
    await Promise.resolve();
    expect(getLastTerminalHostSnapshot()?.webRequestCount).toBe(0);
  });

  it("durable release clears residual pier.click when base is terminal", async () => {
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
    const releaseSettings = requestTerminalWebFocus("settings-dialog");
    requestTerminalWebFocus("pier.click");
    expect(getLastTerminalHostSnapshot()?.webRequestCount).toBe(2);

    releaseSettings();
    // 同步：durable 已去，pier.click 仍在（microtask 前）
    expect(getLastTerminalHostSnapshot()?.webRequestCount).toBe(1);
    expect(getTerminalFocusRoutingDebugSnapshot().webRequestIds).toEqual([
      "pier.click",
    ]);

    await Promise.resolve();
    expect(getLastTerminalHostSnapshot()).toEqual(
      expect.objectContaining({
        basePanel: { kind: "terminal", panelId: "terminal-1" },
        webRequestCount: 0,
      })
    );
    expect(getTerminalFocusRoutingDebugSnapshot().effectiveKind).toBe(
      "terminal"
    );
  });

  it("release + restoreTerminalFocusAfterWebOverlayDismiss does not leave residual pier.click", async () => {
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
    const release = requestTerminalWebFocus("notification-center");
    requestTerminalWebFocus("pier.click");
    applyHostSnapshot.mockClear();
    release();
    // 模拟 fullscreen outside cleanup 同步 restore
    requestTerminalFocusIntent("terminal-1");
    expect(getLastTerminalHostSnapshot()?.webRequestCount).toBe(0);
    const afterRestoreCalls = applyHostSnapshot.mock.calls.length;
    await Promise.resolve();
    // microtask reconcile 应 no-op（无 pier.click），不再 bump
    expect(getLastTerminalHostSnapshot()?.webRequestCount).toBe(0);
    expect(applyHostSnapshot.mock.calls.length).toBe(afterRestoreCalls);
  });

  it("durable release after concurrent pier.click (outside-close race) restores terminal", async () => {
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
    const releaseDialog = requestTerminalWebFocus("app-dialog");
    // 模拟 outside-click：先 pointerdown 加 pier.click，再 release durable
    requestTerminalWebFocus("pier.click");
    releaseDialog();
    await Promise.resolve();
    expect(getLastTerminalHostSnapshot()?.webRequestCount).toBe(0);
    expect(getTerminalFocusRoutingDebugSnapshot().effectiveKind).toBe(
      "terminal"
    );
  });

  it("releasing one of two durables leaves web focus and pier.click", async () => {
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
    const releaseA = requestTerminalWebFocus("settings-dialog");
    requestTerminalWebFocus("command-palette");
    requestTerminalWebFocus("pier.click");
    releaseA();
    await Promise.resolve();
    expect(getLastTerminalHostSnapshot()?.webRequestCount).toBe(2);
    expect(getTerminalFocusRoutingDebugSnapshot().webRequestIds).toEqual([
      "command-palette",
      "pier.click",
    ]);
  });

  it("durable release with base=web only clears pier.click noise", async () => {
    setTerminalBasePanel({ kind: "web" });
    const release = requestTerminalWebFocus("settings-dialog");
    requestTerminalWebFocus("pier.click");
    release();
    await Promise.resolve();
    expect(getLastTerminalHostSnapshot()).toEqual(
      expect.objectContaining({
        basePanel: { kind: "web" },
        webRequestCount: 0,
      })
    );
  });

  it("duplicate web focus request is idempotent", () => {
    requestTerminalWebFocus("a");
    requestTerminalWebFocus("a");
    expect(getLastTerminalHostSnapshot()?.webRequestCount).toBe(1);
  });

  it("changing base intent does not clear independent Web focus owners", () => {
    setTerminalBasePanel({ kind: "web" });
    requestTerminalWebFocus("dialog");
    requestTerminalWebFocus("command-palette");

    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });

    expect(getLastTerminalHostSnapshot()).toEqual(
      expect.objectContaining({
        basePanel: { kind: "terminal", panelId: "terminal-1" },
        webRequestCount: 2,
      })
    );
    expect(applyHostSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ webRequestCount: 2 })
    );
  });

  it("registers and disposes a fullscreen Web overlay rect", () => {
    const registration = registerTerminalFullscreenWebOverlay("dialog");

    expect(getLastTerminalHostSnapshot()?.webOverlayRects).toHaveLength(1);

    registration.dispose();

    expect(getLastTerminalHostSnapshot()?.webOverlayRects).toHaveLength(0);
  });

  it("routes the whole terminal panel to Web for the duration of a drag", () => {
    const panel = document.createElement("div");
    panel.getBoundingClientRect = () =>
      ({
        bottom: 220,
        height: 200,
        left: 10,
        right: 410,
        top: 20,
        width: 400,
        x: 10,
        y: 20,
      }) as DOMRect;

    const capture = beginTerminalPanelWebDragCapture("terminal-1", panel);

    expect(getLastTerminalHostSnapshot()).toMatchObject({
      webOverlayRects: [
        {
          id: "terminal-floating-drag:terminal-1",
          frame: { height: 200, width: 400, x: 10, y: 20 },
        },
      ],
      webRequestCount: 1,
    });

    capture.dispose();
    capture.dispose();

    expect(getLastTerminalHostSnapshot()).toMatchObject({
      webOverlayRects: [],
      webRequestCount: 0,
    });
  });
});

describe("terminal→web hand-off transient blur suppression", () => {
  let applyHostSnapshot: ReturnType<typeof vi.fn>;
  let radixBlurListener: ReturnType<typeof vi.fn<() => void>>;

  const dispatchWindowBlur = () => window.dispatchEvent(new Event("blur"));

  beforeEach(() => {
    resetTerminalInputRoutingForTests();
    applyHostSnapshot = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        onWindowLayoutPulse: vi.fn(() => vi.fn()),
        terminal: { applyHostSnapshot },
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
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" }); // web → terminal

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
