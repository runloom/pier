import { TerminalOverlayContext } from "@pier/ui/use-terminal-overlay.tsx";
import { fireEvent, render, screen } from "@testing-library/react";
import { useMemo, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { getLastTerminalHostSnapshot } from "@/lib/workspace/terminal-host-state-reconciler.ts";
import { TerminalPanelFloatingHost } from "@/panel-kits/terminal/panel-floating-host.tsx";
import { resetTerminalInputRoutingForTests } from "@/stores/terminal-input-routing-slice.ts";

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

const layoutFixture = {
  itemWidth: 180,
  pillWidth: 140,
  rootHeight: 300,
  rootWidth: 500,
  search: { height: 40, width: 120, x: 360, y: 12 },
};

describe("terminal panel floating host", () => {
  beforeEach(async () => {
    await initI18n();
    resetTerminalInputRoutingForTests();
    layoutFixture.itemWidth = 180;
    layoutFixture.pillWidth = 140;
    layoutFixture.rootHeight = 300;
    layoutFixture.rootWidth = 500;
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: { applyHostSnapshot: vi.fn() },
        window: { onLayoutPulse: vi.fn(() => () => undefined) },
      },
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getRect(this: HTMLElement) {
        if (this.dataset.testid === "floating-host-fixture") {
          return rect(0, 0, layoutFixture.rootWidth, layoutFixture.rootHeight);
        }
        // 单节点胶囊同时带 floating-item + floating-pill；宽度用 pillWidth。
        if (
          this.dataset.floatingPill === "runtime-controls" ||
          this.dataset.floatingItem === "runtime-controls"
        ) {
          return rect(160, 8, layoutFixture.pillWidth, 32);
        }
        if (this.dataset.floatingItem === "terminal-search") {
          return rect(
            layoutFixture.search.x,
            layoutFixture.search.y,
            layoutFixture.search.width,
            layoutFixture.search.height
          );
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
    // 单节点：定位 + 绘制 + hit-test 同一元素；内容定宽，right 锚定。
    expect(primary?.style.width).toBe("max-content");
    expect(primary?.style.minWidth).toBe("");
    expect(primary?.style.maxWidth).toBe("");
    expect(primary?.style.left).toBe("auto");
    // 默认 x=1：right = 8；与右上 utility 搜索相交时下移 y=60
    // （search 在 left 系 360..480；pill width=140 在 right=8 时 left=352 重叠）
    expect(primary?.style.right).toBe("8px");
    expect(primary?.style.top).toBe("60px");
    expect(primary?.style.transform).toBe("");
    expect(primary).toHaveAttribute("data-floating-pill", "runtime-controls");
    expect(primary).toHaveClass(
      "pointer-events-auto",
      "inline-flex",
      "absolute",
      "rounded-full",
      "border",
      "border-border",
      "bg-popover",
      "shadow-background/40",
      "shadow-lg"
    );
    expect(primary).not.toHaveClass("w-full", "w-max", "max-w-full", "left-0");
    expect(primary).not.toHaveClass("ring-1", "ring-foreground/5");
    expect(registerElement).toHaveBeenCalledWith(
      "terminal-floating:terminal-1:runtime-controls",
      primary
    );

    const handle = screen.getByRole("button", { name: "Move run controls" });
    expect(handle).toHaveAttribute("data-slot", "button");
    expect(handle).toHaveAttribute("data-tone", "muted");
    expect(handle).toHaveAttribute("data-variant", "ghost");
    expect(primary?.querySelector('[data-slot="separator"]')).not.toBeNull();
    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 400,
      clientY: 70,
      pointerId: 7,
    });
    expect(primary).toHaveAttribute("data-dragging", "true");
    expect(getLastTerminalHostSnapshot()).toMatchObject({
      webOverlayRects: [
        {
          frame: { height: 300, width: 500, x: 0, y: 0 },
          id: "terminal-floating-drag:terminal-1",
        },
      ],
    });

    // 指针右移 → CSS right 减小 → 归一化 x 增大（更靠右）；此处从 right=8 再右移会钳在 8
    // 指针左移 → right 增大 → 归一化 x 减小
    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 320,
      clientY: 120,
      pointerId: 7,
    });
    fireEvent.pointerUp(window, {
      button: 0,
      clientX: 320,
      clientY: 120,
      pointerId: 7,
    });

    const dragCommit = commit.mock.calls.at(-1)?.[1];
    expect(dragCommit?.x).toBeLessThan(1);
    expect(dragCommit?.y).toBeGreaterThan(0.2);
    expect(primary).toHaveAttribute("data-dragging", "false");
    expect(getLastTerminalHostSnapshot()?.webOverlayRects).toEqual([]);

    // 拖到面板右缘：right 钳到 inset（8px），归一化 x=1。
    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 300,
      clientY: 100,
      pointerId: 8,
    });
    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 2000,
      clientY: 100,
      pointerId: 8,
    });
    fireEvent.pointerUp(window, {
      button: 0,
      clientX: 2000,
      clientY: 100,
      pointerId: 8,
    });
    expect(primary?.style.right).toBe("8px");
    expect(commit).toHaveBeenLastCalledWith(
      "runtime-controls",
      expect.objectContaining({ x: 1 })
    );

    fireEvent.doubleClick(handle);
    expect(commit).toHaveBeenLastCalledWith("runtime-controls", {
      x: 1,
      y: 0,
    });
  });

  it("aggregates pointer and focus-within interaction", () => {
    const onInteractionChange = vi.fn();

    function Fixture() {
      const panelRootRef = useRef<HTMLDivElement>(null);
      return (
        <div data-testid="floating-host-fixture" ref={panelRootRef}>
          <TerminalPanelFloatingHost
            layout={{ positions: {}, version: 1 }}
            onPositionCommit={vi.fn()}
            panelId="terminal-1"
            panelRootRef={panelRootRef}
            primary={{
              content: <button type="button">Open result</button>,
              id: "runtime-controls",
              onInteractionChange,
            }}
          />
          <button type="button">Outside</button>
        </div>
      );
    }

    const { container } = render(<Fixture />);
    const primary = container.querySelector<HTMLElement>(
      '[data-floating-item="runtime-controls"]'
    );
    const handle = screen.getByRole("button", { name: "Move run controls" });
    const contentButton = screen.getByRole("button", { name: "Open result" });
    const outsideButton = screen.getByRole("button", { name: "Outside" });
    expect(primary).not.toBeNull();

    fireEvent.pointerEnter(primary as HTMLElement);
    expect(onInteractionChange).toHaveBeenLastCalledWith(true);
    fireEvent.pointerLeave(primary as HTMLElement);
    expect(onInteractionChange).toHaveBeenLastCalledWith(false);

    onInteractionChange.mockClear();
    fireEvent.focus(handle);
    expect(onInteractionChange).toHaveBeenCalledOnce();
    expect(onInteractionChange).toHaveBeenLastCalledWith(true);

    fireEvent.blur(handle, { relatedTarget: contentButton });
    fireEvent.focus(contentButton, { relatedTarget: handle });
    expect(onInteractionChange).toHaveBeenCalledOnce();

    fireEvent.pointerEnter(primary as HTMLElement);
    fireEvent.pointerLeave(primary as HTMLElement);
    expect(onInteractionChange).toHaveBeenCalledOnce();

    fireEvent.blur(contentButton, { relatedTarget: outsideButton });
    fireEvent.focus(outsideButton, { relatedTarget: contentButton });
    expect(onInteractionChange).toHaveBeenCalledTimes(2);
    expect(onInteractionChange).toHaveBeenLastCalledWith(false);
  });

  it("clears interaction on callback change, primary replacement, and unmount", () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();

    function Fixture({
      callback,
      id,
      mounted,
    }: {
      callback: (interacting: boolean) => void;
      id: string;
      mounted: boolean;
    }) {
      const panelRootRef = useRef<HTMLDivElement>(null);
      return (
        <div data-testid="floating-host-fixture" ref={panelRootRef}>
          <TerminalPanelFloatingHost
            layout={{ positions: {}, version: 1 }}
            onPositionCommit={vi.fn()}
            panelId="terminal-1"
            panelRootRef={panelRootRef}
            primary={
              mounted
                ? {
                    content: <span>Run test</span>,
                    id,
                    onInteractionChange: callback,
                  }
                : undefined
            }
          />
        </div>
      );
    }

    const { container, rerender, unmount } = render(
      <Fixture callback={firstCallback} id="runtime-controls" mounted />
    );
    fireEvent.pointerEnter(
      container.querySelector(
        '[data-floating-item="runtime-controls"]'
      ) as Element
    );
    expect(firstCallback).toHaveBeenLastCalledWith(true);

    rerender(
      <Fixture callback={secondCallback} id="runtime-controls" mounted />
    );
    expect(firstCallback).toHaveBeenLastCalledWith(false);

    fireEvent.pointerEnter(
      container.querySelector(
        '[data-floating-item="runtime-controls"]'
      ) as Element
    );
    expect(secondCallback).toHaveBeenLastCalledWith(true);

    rerender(<Fixture callback={secondCallback} id="replacement" mounted />);
    expect(secondCallback).toHaveBeenLastCalledWith(false);

    fireEvent.pointerEnter(
      container.querySelector('[data-floating-item="replacement"]') as Element
    );
    expect(secondCallback).toHaveBeenLastCalledWith(true);
    unmount();
    expect(secondCallback).toHaveBeenLastCalledWith(false);
  });

  it("does not re-anchor when only capsule content width would change", () => {
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
    const primary = container.querySelector<HTMLElement>(
      '[data-floating-item="runtime-controls"]'
    );
    expect(primary).not.toBeNull();
    // 默认 x=1 + 与搜索相交 → right 仍为 8（下移避障不改 right）
    expect(primary?.style.right).toBe("8px");
    commit.mockClear();

    // 生产路径不 observe 胶囊：时长变宽不会触发 restore，right 保持。
    layoutFixture.pillWidth = 180;
    layoutFixture.itemWidth = 180;
    expect(primary?.style.right).toBe("8px");
    expect(commit).not.toHaveBeenCalled();
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
