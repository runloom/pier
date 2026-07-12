import { TerminalOverlayContext } from "@pier/ui/use-terminal-overlay.tsx";
import { fireEvent, render, screen } from "@testing-library/react";
import { useMemo, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { TerminalPanelFloatingHost } from "@/panel-kits/terminal/terminal-panel-floating-host.tsx";
import {
  getLastTerminalInputRoutingSnapshot,
  resetTerminalInputRoutingForTests,
} from "@/stores/terminal-input-routing-slice.ts";

class ResizeObserverMock {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    bottom: y + height,
    height,
    left: x,
    right: x + width,
    toJSON: () => ({}),
    top: y,
    width,
    x,
    y,
  } as DOMRect;
}

describe("terminal panel floating host", () => {
  beforeEach(async () => {
    await initI18n();
    resetTerminalInputRoutingForTests();
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: { applyInputRouting: vi.fn() },
        window: { onLayoutPulse: vi.fn(() => () => undefined) },
      },
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getRect(this: HTMLElement) {
        if (this.dataset.testid === "floating-host-fixture") {
          return rect(0, 0, 500, 300);
        }
        if (this.dataset.floatingItem === "runtime-controls") {
          return rect(160, 8, 180, 32);
        }
        if (this.dataset.floatingItem === "terminal-search") {
          return rect(360, 12, 120, 40);
        }
        return rect(0, 0, 0, 0);
      }
    );
  });

  afterEach(() => {
    resetTerminalInputRoutingForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("owns one draggable primary slot and a separately routed utility slot", () => {
    const commit = vi.fn();
    const registerElement = vi.fn(() => ({
      dispose: vi.fn(),
      flush: vi.fn(),
    }));

    function Fixture() {
      const panelRootRef = useRef<HTMLDivElement>(null);
      return (
        <TerminalOverlayContext.Provider value={{ registerElement }}>
          <div
            className="relative h-[300px] w-[500px]"
            data-testid="floating-host-fixture"
            ref={panelRootRef}
          >
            <TerminalPanelFloatingHost
              layout={{ positions: {}, version: 1 }}
              onPositionCommit={commit}
              panelId="terminal-1"
              panelRootRef={panelRootRef}
              primary={{
                content: <span>Run test</span>,
                id: "runtime-controls",
              }}
              utility={[
                { content: <span>Search</span>, id: "terminal-search" },
              ]}
            />
          </div>
        </TerminalOverlayContext.Provider>
      );
    }

    const { container } = render(<Fixture />);

    expect(
      container.querySelector('[data-floating-slot="primary"]')
    ).toHaveTextContent("Run test");
    expect(
      container.querySelector('[data-floating-slot="utility"]')
    ).toHaveTextContent("Search");
    expect(registerElement).toHaveBeenCalledWith(
      "terminal-floating:terminal-1:runtime-controls",
      expect.any(HTMLElement)
    );
    expect(registerElement).toHaveBeenCalledWith(
      "terminal-floating:terminal-1:terminal-search",
      expect.any(HTMLElement)
    );
    const primary = container.querySelector<HTMLElement>(
      '[data-floating-item="runtime-controls"]'
    );
    expect(primary).not.toBeNull();
    expect(primary?.style.width).toBe("fit-content");
    expect(primary?.style.minWidth).toBe("min(20rem, calc(100% - 1rem))");
    expect(primary?.style.maxWidth).toBe("min(25rem, calc(100% - 1rem))");
    expect(primary?.style.left).toBe("160px");
    expect(primary?.style.top).toBe("8px");
    expect(primary?.style.transform).toBe("");
    const shell = primary?.firstElementChild;
    expect(shell).toHaveClass(
      "rounded-full",
      "border",
      "border-border",
      "bg-popover",
      "shadow-background/40",
      "shadow-lg"
    );
    expect(shell).not.toHaveClass("ring-1", "ring-foreground/5");

    const handle = screen.getByRole("button", { name: "Move run controls" });
    expect(handle).toHaveAttribute("data-slot", "button");
    expect(handle).toHaveAttribute("data-tone", "muted");
    expect(handle).toHaveAttribute("data-variant", "ghost");
    expect(primary?.querySelector('[data-slot="separator"]')).not.toBeNull();
    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 170,
      clientY: 20,
      pointerId: 7,
    });
    expect(primary).toHaveAttribute("data-dragging", "true");
    expect(getLastTerminalInputRoutingSnapshot()).toMatchObject({
      webOverlayRects: [
        {
          frame: { height: 300, width: 500, x: 0, y: 0 },
          id: "terminal-floating-drag:terminal-1",
        },
      ],
    });

    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 250,
      clientY: 80,
      pointerId: 7,
    });
    fireEvent.pointerUp(window, {
      button: 0,
      clientX: 250,
      clientY: 80,
      pointerId: 7,
    });

    const dragCommit = commit.mock.calls.at(-1)?.[1];
    expect(dragCommit?.x).toBeGreaterThan(0.7);
    expect(dragCommit?.y).toBeGreaterThan(0.2);
    expect(primary).toHaveAttribute("data-dragging", "false");
    expect(getLastTerminalInputRoutingSnapshot()?.webOverlayRects).toEqual([]);

    fireEvent.doubleClick(handle);
    expect(commit).toHaveBeenLastCalledWith("runtime-controls", {
      x: 0.5,
      y: 0,
    });
  });

  it("keeps content and event routing registered until the whole capsule exits", () => {
    const dispose = vi.fn();
    const registerElement = vi.fn(() => ({
      dispose,
      flush: vi.fn(),
    }));

    function Fixture({
      mounted,
      phase,
    }: {
      mounted: boolean;
      phase: "exiting" | "visible";
    }) {
      const panelRootRef = useRef<HTMLDivElement>(null);
      const registry = useMemo(() => ({ registerElement }), []);
      return (
        <TerminalOverlayContext.Provider value={registry}>
          <div data-testid="floating-host-fixture" ref={panelRootRef}>
            <TerminalPanelFloatingHost
              layout={{ positions: {}, version: 1 }}
              onPositionCommit={vi.fn()}
              panelId="terminal-1"
              panelRootRef={panelRootRef}
              primary={
                mounted
                  ? {
                      content: <span>Failed test</span>,
                      id: "runtime-controls",
                      phase,
                    }
                  : undefined
              }
            />
          </div>
        </TerminalOverlayContext.Provider>
      );
    }

    const { container, rerender } = render(<Fixture mounted phase="visible" />);
    rerender(<Fixture mounted phase="exiting" />);

    const item = container.querySelector(
      '[data-floating-item="runtime-controls"]'
    );
    expect(item).toHaveAttribute("data-phase", "exiting");
    expect(item).toHaveTextContent("Failed test");
    expect(dispose).not.toHaveBeenCalled();

    rerender(<Fixture mounted={false} phase="exiting" />);
    expect(
      container.querySelector('[data-floating-item="runtime-controls"]')
    ).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
