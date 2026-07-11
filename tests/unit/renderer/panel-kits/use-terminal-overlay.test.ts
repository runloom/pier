import {
  TerminalOverlayContext,
  useTerminalOverlay,
  useTerminalOverlayRegistration,
} from "@pier/ui/use-terminal-overlay.tsx";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLastTerminalInputRoutingSnapshot,
  registerTerminalElementWebOverlay,
  resetTerminalInputRoutingForTests,
} from "@/stores/terminal-input-routing-slice.ts";

class ResizeObserverMock {
  disconnect(): void {
    // Test polyfill no-op.
  }
  observe(): void {
    // Test polyfill no-op.
  }
  unobserve(): void {
    // Test polyfill no-op.
  }
}

/**
 * jsdom 的 getBoundingClientRect 全返回 0，而 store 会跳过 width/height <= 0 的
 * 矩形（cssDomRectToTerminalFrame 返回 null）。给元素一个非零尺寸才会真正注册几何。
 */
function makeSizedElement(): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      bottom: 70,
      height: 50,
      left: 10,
      right: 110,
      toJSON: () => ({}),
      top: 20,
      width: 100,
      x: 10,
      y: 20,
    }) as DOMRect;
  return el;
}

function snapshot() {
  return getLastTerminalInputRoutingSnapshot();
}

const registry = {
  registerElement: registerTerminalElementWebOverlay,
};

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    TerminalOverlayContext.Provider,
    { value: registry },
    children
  );
}

describe("useTerminalOverlay", () => {
  beforeEach(() => {
    resetTerminalInputRoutingForTests();
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1)
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn(() => undefined)
    );
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        onWindowLayoutPulse: vi.fn(() => vi.fn()),
        terminal: { applyInputRouting: vi.fn() },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers geometry only — never a web focus request", () => {
    const { result } = renderHook(() => useTerminalOverlay(), { wrapper });
    const el = makeSizedElement();

    result.current(el);

    expect(snapshot()?.webOverlayRects).toHaveLength(1);
    expect(snapshot()?.webRequestCount).toBe(0);

    result.current(null);

    expect(snapshot()?.webOverlayRects).toHaveLength(0);
    expect(snapshot()?.webRequestCount).toBe(0);
  });

  it("re-attaching to a new element disposes the previous registration", () => {
    const { result } = renderHook(() => useTerminalOverlay(), { wrapper });

    result.current(makeSizedElement());
    result.current(makeSizedElement());

    // 旧注册被释放，只保留一个几何矩形。
    expect(snapshot()?.webOverlayRects).toHaveLength(1);
  });

  it("flushes registered geometry synchronously after transform movement", () => {
    const registerElement = vi.fn(() => ({
      dispose: vi.fn(),
      flush: vi.fn(),
    }));
    const customWrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        TerminalOverlayContext.Provider,
        { value: { registerElement } },
        children
      );
    const { result } = renderHook(
      () => useTerminalOverlayRegistration("runtime-control"),
      { wrapper: customWrapper }
    );

    result.current.ref(makeSizedElement());
    result.current.flush();

    expect(registerElement).toHaveBeenCalledWith(
      "runtime-control",
      expect.any(HTMLElement)
    );
    expect(registerElement.mock.results[0]?.value.flush).toHaveBeenCalledTimes(
      1
    );
  });

  it("degrades to noop without a Provider — no throw, store state unchanged", () => {
    // 不包 Provider，使用默认 noopRegistry。
    const { result } = renderHook(() => useTerminalOverlay());

    // 不应抛错，也不应写入 terminal-input-routing store（snapshot 保持 null）。
    expect(() => result.current(makeSizedElement())).not.toThrow();
    expect(snapshot()).toBeNull();

    expect(() => result.current(null)).not.toThrow();
    expect(snapshot()).toBeNull();
  });
});
