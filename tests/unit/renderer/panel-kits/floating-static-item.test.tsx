import { TerminalOverlayContext } from "@pier/ui/use-terminal-overlay.tsx";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLastTerminalHostSnapshot } from "@/lib/workspace/terminal-host-state-reconciler.ts";
import { TerminalFloatingStaticItem } from "@/panel-kits/terminal/floating-static-item.tsx";
import {
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

const registry = { registerElement: registerTerminalElementWebOverlay };

/**
 * 静态工具槽的注册元素只是布局外壳（透明、直角、无阴影）；绘制圆角胶囊 /
 * 搜索条的是它的第一个子元素。外壳尺寸不能只是 0，否则 store 直接跳过注册。
 */
function stubNonZeroRects(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    bottom: 70,
    height: 50,
    left: 10,
    right: 110,
    toJSON: () => ({}),
    top: 20,
    width: 100,
    x: 10,
    y: 20,
  } as DOMRect);
}

describe("TerminalFloatingStaticItem overlay appearance", () => {
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
        terminal: { applyHostSnapshot: vi.fn() },
      },
    });
    stubNonZeroRects();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("samples radius and shadow from the painted child, not the transparent slot", () => {
    const setElement = vi.fn();
    render(
      <TerminalOverlayContext.Provider value={registry}>
        <TerminalFloatingStaticItem
          id="terminal-search"
          panelId="p1"
          setElement={setElement}
        >
          <div
            data-testid="painted"
            style={{
              borderBottomLeftRadius: "24px",
              borderBottomRightRadius: "24px",
              borderTopLeftRadius: "24px",
              borderTopRightRadius: "24px",
              boxShadow: "rgba(0, 0, 0, 0.2) 0px 8px 16px 0px",
            }}
          />
        </TerminalFloatingStaticItem>
      </TerminalOverlayContext.Provider>
    );

    const rects = getLastTerminalHostSnapshot()?.webOverlayRects ?? [];
    const rect = rects.find(
      (entry) => entry.id === "terminal-floating:p1:terminal-search"
    );
    expect(rect?.frame).toMatchObject({
      height: 50,
      width: 100,
      x: 10,
      y: 20,
    });
    // 外壳无圆角、无阴影：读到值就证明外观取自子元素。
    expect(rect?.radius).toBe(24);
    expect(rect?.shadows).toHaveLength(1);
  });
});
