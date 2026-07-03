import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetTerminalOverlayFocusForTests,
  useTerminalStore,
} from "@/stores/terminal.store.ts";
import {
  getLastTerminalInputRoutingSnapshot,
  resetTerminalInputRoutingForTests,
} from "@/stores/terminal-input-routing-slice.ts";

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
    useTerminalStore.getState().activateOverlay("search:a");

    expect(useTerminalStore.getState().activeOverlayId).toBe("search:a");
    expect(webRequestCount()).toBe(1);
  });

  it("activating a second overlay keeps a single owner (previous released)", () => {
    useTerminalStore.getState().activateOverlay("search:a");
    useTerminalStore.getState().activateOverlay("search:b");

    expect(useTerminalStore.getState().activeOverlayId).toBe("search:b");
    expect(webRequestCount()).toBe(1);
  });

  it("re-activating the same overlay is a no-op", () => {
    useTerminalStore.getState().activateOverlay("search:a");
    useTerminalStore.getState().activateOverlay("search:a");

    expect(webRequestCount()).toBe(1);
  });

  it("yieldToTerminal releases the active overlay's web request", () => {
    useTerminalStore.getState().activateOverlay("search:a");
    useTerminalStore.getState().yieldToTerminal();

    expect(useTerminalStore.getState().activeOverlayId).toBeNull();
    expect(webRequestCount()).toBe(0);
  });

  it("yieldToTerminal with no active overlay is a no-op", () => {
    useTerminalStore.getState().yieldToTerminal();

    expect(useTerminalStore.getState().activeOverlayId).toBeNull();
    // 无活跃浮层时 yield 不发布任何 routing 更新（快照保持未创建）。
    expect(getLastTerminalInputRoutingSnapshot()).toBeNull();
  });

  it("deactivating a non-active overlay id does nothing", () => {
    useTerminalStore.getState().activateOverlay("search:a");
    useTerminalStore.getState().deactivateOverlay("search:other");

    expect(useTerminalStore.getState().activeOverlayId).toBe("search:a");
    expect(webRequestCount()).toBe(1);
  });

  it("deactivating the active overlay releases its web request", () => {
    useTerminalStore.getState().activateOverlay("search:a");
    useTerminalStore.getState().deactivateOverlay("search:a");

    expect(useTerminalStore.getState().activeOverlayId).toBeNull();
    expect(webRequestCount()).toBe(0);
  });
});
