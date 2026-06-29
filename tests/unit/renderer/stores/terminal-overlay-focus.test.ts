import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLastTerminalInputRoutingSnapshot,
  resetTerminalInputRoutingForTests,
} from "@/stores/terminal-input-routing.store.ts";
import {
  resetTerminalOverlayFocusForTests,
  useTerminalOverlayFocus,
} from "@/stores/terminal-overlay-focus.store.ts";

function webRequestCount(): number | undefined {
  return getLastTerminalInputRoutingSnapshot()?.webRequestCount;
}

describe("terminal overlay focus store", () => {
  beforeEach(() => {
    resetTerminalInputRoutingForTests();
    resetTerminalOverlayFocusForTests();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        onWindowLayoutPulse: vi.fn(() => vi.fn()),
        terminal: {
          applyInputRouting: vi.fn(),
        },
      },
    });
  });

  it("activating an overlay holds a single web focus request", () => {
    useTerminalOverlayFocus.getState().activateOverlay("search:a");

    expect(useTerminalOverlayFocus.getState().activeOverlayId).toBe("search:a");
    expect(webRequestCount()).toBe(1);
  });

  it("activating a second overlay keeps a single owner (previous released)", () => {
    useTerminalOverlayFocus.getState().activateOverlay("search:a");
    useTerminalOverlayFocus.getState().activateOverlay("search:b");

    expect(useTerminalOverlayFocus.getState().activeOverlayId).toBe("search:b");
    expect(webRequestCount()).toBe(1);
  });

  it("re-activating the same overlay is a no-op", () => {
    useTerminalOverlayFocus.getState().activateOverlay("search:a");
    useTerminalOverlayFocus.getState().activateOverlay("search:a");

    expect(webRequestCount()).toBe(1);
  });

  it("yieldToTerminal releases the active overlay's web request", () => {
    useTerminalOverlayFocus.getState().activateOverlay("search:a");
    useTerminalOverlayFocus.getState().yieldToTerminal();

    expect(useTerminalOverlayFocus.getState().activeOverlayId).toBeNull();
    expect(webRequestCount()).toBe(0);
  });

  it("yieldToTerminal with no active overlay is a no-op", () => {
    useTerminalOverlayFocus.getState().yieldToTerminal();

    expect(useTerminalOverlayFocus.getState().activeOverlayId).toBeNull();
    // 无活跃浮层时 yield 不发布任何 routing 更新（快照保持未创建）。
    expect(getLastTerminalInputRoutingSnapshot()).toBeNull();
  });

  it("deactivating a non-active overlay id does nothing", () => {
    useTerminalOverlayFocus.getState().activateOverlay("search:a");
    useTerminalOverlayFocus.getState().deactivateOverlay("search:other");

    expect(useTerminalOverlayFocus.getState().activeOverlayId).toBe("search:a");
    expect(webRequestCount()).toBe(1);
  });

  it("deactivating the active overlay releases its web request", () => {
    useTerminalOverlayFocus.getState().activateOverlay("search:a");
    useTerminalOverlayFocus.getState().deactivateOverlay("search:a");

    expect(useTerminalOverlayFocus.getState().activeOverlayId).toBeNull();
    expect(webRequestCount()).toBe(0);
  });
});
