import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerTerminalLayoutAnchor,
  setTerminalLayoutPresentationScheduler,
} from "@/panel-kits/terminal/terminal-layout-coordinator.ts";
import {
  readTerminalAnchorFrame,
  readTerminalViewportFrame,
} from "@/panel-kits/terminal/terminal-viewport.ts";
import { useTerminalStore } from "@/stores/terminal.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

class TestResizeObserver {
  observe() {
    // Test no-op.
  }
  disconnect() {
    // Test no-op.
  }
}

describe("terminal layout coordinator", () => {
  const originalInnerHeight = window.innerHeight;
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    useZoomStore.setState({ windowZoomLevel: 0 });
    window.localStorage.clear();
    globalThis.ResizeObserver =
      TestResizeObserver as unknown as typeof ResizeObserver;
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          onPresentationApplied: (
            cb: (payload: { rendererSequence: number }) => void
          ) => {
            window.dispatchEvent(
              new CustomEvent("test-presentation-applied-subscriber", {
                detail: cb,
              })
            );
            return () => undefined;
          },
        },
        window: {
          onLayoutPulse: (
            cb: (pulse: {
              reason: "resize" | "view-zoom" | "zoom";
              windowZoomLevel?: number;
            }) => void
          ) => {
            window.dispatchEvent(
              new CustomEvent("test-window-layout-pulse-subscriber", {
                detail: cb,
              })
            );
            return () => undefined;
          },
        },
      },
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 800,
    });
  });

  afterEach(() => {
    useZoomStore.setState({ windowZoomLevel: 0 });
    window.localStorage.clear();
    Reflect.deleteProperty(window, "pier");
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
    useTerminalStore.setState({
      lastDownlinkSequence: 0,
      placeholderVisible: false,
      suppressTerminals: false,
    });
  });

  it("converts DOM anchor rects to native window points with the active window zoom", () => {
    const anchor = document.createElement("div");
    anchor.getBoundingClientRect = () =>
      ({
        bottom: 320,
        height: 300,
        left: 10,
        right: 410,
        top: 20,
        width: 400,
        x: 10,
        y: 20,
        toJSON: () => null,
      }) as DOMRect;
    useZoomStore.setState({ windowZoomLevel: 2 });

    expect(readTerminalAnchorFrame(anchor)).toEqual({
      height: 432,
      width: 576,
      x: 14.4,
      y: 28.8,
    });
  });

  it("reports the renderer viewport in the same native point coordinate space", () => {
    useZoomStore.setState({ windowZoomLevel: -1 });

    expect(readTerminalViewportFrame()).toEqual({
      height: 500,
      width: 666.667,
      x: 0,
      y: 0,
    });
  });

  it("flushes registered terminal frames only after the window zoom layout pulse", () => {
    const anchor = document.createElement("div");
    anchor.getBoundingClientRect = () =>
      ({
        bottom: 320,
        height: 300,
        left: 10,
        right: 410,
        top: 20,
        width: 400,
        x: 10,
        y: 20,
        toJSON: () => null,
      }) as DOMRect;
    const reasons: string[] = [];
    const unsetScheduler = setTerminalLayoutPresentationScheduler((reason) => {
      reasons.push(reason);
    });
    const pulseSubscribers: Array<
      (pulse: {
        reason: "resize" | "view-zoom" | "zoom";
        windowZoomLevel?: number;
      }) => void
    > = [];
    window.addEventListener(
      "test-window-layout-pulse-subscriber",
      (event) => {
        pulseSubscribers.push((event as CustomEvent).detail);
      },
      { once: true }
    );
    const registration = registerTerminalLayoutAnchor("terminal-1", anchor);
    reasons.length = 0;

    useZoomStore.setState({ windowZoomLevel: 1 });

    expect(reasons).not.toContain("window-view-zoom");
    expect(pulseSubscribers).toHaveLength(1);

    pulseSubscribers[0]?.({ reason: "view-zoom", windowZoomLevel: 1 });

    expect(reasons).toContain("window-view-zoom");

    registration.dispose();
    unsetScheduler();
  });

  function captureResizePulse(): {
    trigger: (pulse: {
      reason: "resize" | "view-zoom" | "zoom";
      phase?: "active" | "end";
    }) => void;
    triggerAck: (rendererSequence: number) => void;
    dispose: () => void;
  } {
    const anchor = document.createElement("div");
    anchor.getBoundingClientRect = () =>
      ({
        bottom: 320,
        height: 300,
        left: 10,
        right: 410,
        top: 20,
        width: 400,
        x: 10,
        y: 20,
        toJSON: () => null,
      }) as DOMRect;
    let pulseCb: ((pulse: { reason: string; phase?: string }) => void) | null =
      null;
    let ackCb: ((payload: { rendererSequence: number }) => void) | null = null;
    window.addEventListener(
      "test-window-layout-pulse-subscriber",
      (event) => {
        pulseCb = (event as CustomEvent).detail;
      },
      { once: true }
    );
    window.addEventListener(
      "test-presentation-applied-subscriber",
      (event) => {
        ackCb = (event as CustomEvent).detail;
      },
      { once: true }
    );
    const registration = registerTerminalLayoutAnchor("terminal-1", anchor);
    return {
      dispose: () => registration.dispose(),
      trigger: (pulse) => pulseCb?.(pulse),
      triggerAck: (rendererSequence) => ackCb?.({ rendererSequence }),
    };
  }

  it("resize 'active' pulse 进入隐身：suppressTerminals 与 placeholderVisible 置 true", () => {
    const { trigger, dispose } = captureResizePulse();
    trigger({ phase: "active", reason: "resize" });
    expect(useTerminalStore.getState().suppressTerminals).toBe(true);
    expect(useTerminalStore.getState().placeholderVisible).toBe(true);
    dispose();
  });

  it("resize 'end' pulse 退出隐身：suppressTerminals 置 false", () => {
    const { trigger, dispose } = captureResizePulse();
    trigger({ phase: "active", reason: "resize" });
    trigger({ phase: "end", reason: "resize" });
    expect(useTerminalStore.getState().suppressTerminals).toBe(false);
    dispose();
  });

  it("'zoom' pulse 收尾隐身（maximize/全屏不带 end，避免卡死）", () => {
    const { trigger, dispose } = captureResizePulse();
    trigger({ phase: "active", reason: "resize" });
    expect(useTerminalStore.getState().suppressTerminals).toBe(true);
    trigger({ reason: "zoom" });
    expect(useTerminalStore.getState().suppressTerminals).toBe(false);
    dispose();
  });

  it("缺失 phase 的 resize pulse 也收尾恢复，不静默卡隐身", () => {
    const { trigger, dispose } = captureResizePulse();
    trigger({ phase: "active", reason: "resize" });
    trigger({ reason: "resize" });
    expect(useTerminalStore.getState().suppressTerminals).toBe(false);
    dispose();
  });

  it("active 后丢失 end：超时兜底自动恢复隐身", () => {
    vi.useFakeTimers();
    try {
      const { trigger, dispose } = captureResizePulse();
      trigger({ phase: "active", reason: "resize" });
      expect(useTerminalStore.getState().suppressTerminals).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(useTerminalStore.getState().suppressTerminals).toBe(false);
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("end 后等 native 就位 ack 才撤占位（ack sequence 追上最新下发才撤）", () => {
    const { trigger, triggerAck, dispose } = captureResizePulse();
    trigger({ phase: "active", reason: "resize" });
    trigger({ phase: "end", reason: "resize" });
    // 终端已恢复可见，但占位仍在，等 native 就位 ack。
    expect(useTerminalStore.getState().suppressTerminals).toBe(false);
    expect(useTerminalStore.getState().placeholderVisible).toBe(true);
    // 模拟 trailing flush 又下发最终帧，lastDownlinkSequence 推到 5。
    useTerminalStore.setState({ lastDownlinkSequence: 5 });
    // native 只应用到 seq=3 < 5：尚未追上，占位不撤。
    triggerAck(3);
    expect(useTerminalStore.getState().placeholderVisible).toBe(true);
    // native 追上最终帧 seq=5：撤占位。
    triggerAck(5);
    expect(useTerminalStore.getState().placeholderVisible).toBe(false);
    dispose();
  });

  it("ack 丢失：超时兜底撤占位", () => {
    vi.useFakeTimers();
    try {
      const { trigger, dispose } = captureResizePulse();
      trigger({ phase: "active", reason: "resize" });
      trigger({ phase: "end", reason: "resize" });
      expect(useTerminalStore.getState().placeholderVisible).toBe(true);
      vi.advanceTimersByTime(500);
      expect(useTerminalStore.getState().placeholderVisible).toBe(false);
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
